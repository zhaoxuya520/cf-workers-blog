#!/usr/bin/env python3
# Local Markdown writer for this Jekyll blog.

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


RE_FRONT_MATTER = re.compile(r"^---\s*$", re.M)
ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_UPLOAD_BYTES = 12 * 1024 * 1024


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _writer_dir() -> Path:
    return Path(__file__).resolve().parent / "writer"


def _posts_dir() -> Path:
    return _repo_root() / "_posts"

def _uploads_dir() -> Path:
    return _repo_root() / "assets" / "uploads"


def _safe_post_path(rel: str) -> Path:
    rel = rel.replace("\\", "/").lstrip("/")
    p = (_repo_root() / rel).resolve()
    posts_root = _posts_dir().resolve()
    if not str(p).startswith(str(posts_root) + os.sep):
        raise ValueError("Invalid post path")
    return p


def _safe_upload_filename(filename: str) -> str:
    name = Path(filename).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("._-") or "image"
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise ValueError("Unsupported image type")
    return name


def _unique_path(base: Path) -> Path:
    if not base.exists():
        return base
    stem = base.stem
    ext = base.suffix
    for i in range(1, 1000):
        candidate = base.with_name(f"{stem}-{i}{ext}")
        if not candidate.exists():
            return candidate
    raise RuntimeError("Unable to allocate filename")


def _parse_multipart_file(body: bytes, boundary: bytes) -> tuple[str, bytes]:
    marker = b"--" + boundary
    parts = body.split(marker)
    for part in parts:
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        header_blob, _, content = part.partition(b"\r\n\r\n")
        headers = header_blob.decode("utf-8", errors="replace").split("\r\n")
        disp = ""
        for h in headers:
            if h.lower().startswith("content-disposition:"):
                disp = h
        if "name=\"file\"" not in disp:
            continue
        m = re.search(r'filename=\"([^\"]+)\"', disp)
        if not m:
            raise ValueError("Missing filename")
        filename = m.group(1)
        if content.endswith(b"\r\n"):
            content = content[:-2]
        return filename, content
    raise ValueError("No file found")


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def _parse_front_matter(text: str) -> tuple[dict, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return ({}, text)
    try:
        end = lines.index("---", 1)
    except ValueError:
        return ({}, text)
    fm_lines = lines[1:end]
    body = "\n".join(lines[end + 1 :]).lstrip("\n")
    fm: dict[str, object] = {}
    for line in fm_lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key == "tags":
            if value.startswith("[") and value.endswith("]"):
                inner = value[1:-1].strip()
                tags = [t.strip().strip("'\"") for t in inner.split(",") if t.strip()]
                fm[key] = tags
            else:
                fm[key] = [value.strip("'\"")] if value else []
        else:
            fm[key] = value.strip("'\"")
    return (fm, body)


def _post_summary(path: Path) -> dict:
    text = _read_text(path)
    fm, body = _parse_front_matter(text)
    title = str(fm.get("title") or path.stem)
    date = str(fm.get("date") or "")
    tags = fm.get("tags") or []
    cover = str(fm.get("cover") or "")
    if not isinstance(tags, list):
        tags = [str(tags)]
    excerpt = ""
    for line in body.splitlines():
        line = line.strip()
        if line:
            excerpt = line
            break
    return {
        "path": str(path.relative_to(_repo_root())).replace("\\", "/"),
        "filename": path.name,
        "title": title,
        "date": date,
        "tags": tags,
        "cover": cover,
        "excerpt": excerpt[:160],
        "mtime": int(path.stat().st_mtime),
    }


def _git(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=str(_repo_root()),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "WriterApp/1.0"

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, data: object) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def log_message(self, fmt: str, *args) -> None:
        return

    def do_GET(self) -> None:
        u = urlparse(self.path)
        if u.path == "/":
            html = (_writer_dir() / "index.html").read_bytes()
            return self._send(HTTPStatus.OK, html, "text/html; charset=utf-8")
        if u.path == "/app.css":
            css = (_writer_dir() / "app.css").read_bytes()
            return self._send(HTTPStatus.OK, css, "text/css; charset=utf-8")
        if u.path == "/app.js":
            js = (_writer_dir() / "app.js").read_bytes()
            return self._send(HTTPStatus.OK, js, "application/javascript; charset=utf-8")

        if u.path == "/api/posts":
            posts = []
            for p in sorted(_posts_dir().glob("*.md"), key=lambda x: x.stat().st_mtime, reverse=True):
                try:
                    posts.append(_post_summary(p))
                except Exception:
                    continue
            return self._json(HTTPStatus.OK, {"posts": posts})

        if u.path == "/api/post":
            qs = parse_qs(u.query)
            rel = (qs.get("path") or [""])[0]
            if not rel:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "Missing path"})
            try:
                p = _safe_post_path(rel)
            except Exception:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid path"})
            if not p.exists():
                return self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            text = _read_text(p)
            fm, body = _parse_front_matter(text)
            return self._json(
                HTTPStatus.OK,
                {"path": rel, "frontMatter": fm, "content": body, "raw": text},
            )

        if u.path == "/api/status":
            branch = _git(["branch", "--show-current"])
            remotes = _git(["remote", "-v"])
            status = _git(["status", "--porcelain"])
            return self._json(
                HTTPStatus.OK,
                {
                    "branch": (branch.stdout or "").strip(),
                    "remotes": (remotes.stdout or "").strip(),
                    "dirty": bool((status.stdout or "").strip()),
                },
            )

        return self._send(HTTPStatus.NOT_FOUND, b"Not Found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        u = urlparse(self.path)

        if u.path == "/api/save":
            data = self._read_json()
            filename = (data.get("filename") or "").strip()
            front = data.get("frontMatter") or {}
            content = data.get("content") or ""
            if not filename:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "Missing filename"})
            if "/" in filename or "\\" in filename or not filename.endswith(".md"):
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid filename"})

            title = str(front.get("title") or "").strip()
            date = str(front.get("date") or "").strip()
            cover = str(front.get("cover") or "").strip()
            tags = front.get("tags") or []
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(",") if t.strip()]
            if not isinstance(tags, list):
                tags = []

            fm_lines = ["---"]
            if title:
                fm_lines.append(f'title: "{title}"')
            if date:
                fm_lines.append(f'date: "{date}"')
            if tags:
                safe_tags = [str(t).replace('"', '\\"') for t in tags if str(t).strip()]
                fm_lines.append("tags: [" + ", ".join([f'"{t}"' for t in safe_tags]) + "]")
            if cover:
                fm_lines.append(f'cover: "{cover}"')
            fm_lines.append("---")
            raw = "\n".join(fm_lines) + "\n\n" + str(content).lstrip("\n") + "\n"

            path = _posts_dir() / filename
            _write_text(path, raw)
            return self._json(HTTPStatus.OK, {"ok": True, "path": str(path.relative_to(_repo_root())).replace("\\", "/")})

        if u.path == "/api/upload-image":
            ctype = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in ctype or "boundary=" not in ctype:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "Expected multipart/form-data"})

            length = int(self.headers.get("Content-Length", "0") or "0")
            if length <= 0 or length > MAX_UPLOAD_BYTES:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "File too large"})

            raw = self.rfile.read(length)
            boundary = ctype.split("boundary=", 1)[1].strip().strip('"').encode("utf-8")
            try:
                filename, content = _parse_multipart_file(raw, boundary)
                safe = _safe_upload_filename(filename)
            except Exception as e:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})

            now = datetime.now()
            folder = _uploads_dir() / f"{now:%Y}" / f"{now:%m}"
            dest = _unique_path(folder / safe)
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(content)
            except Exception as e:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": f"Save failed: {e}"})

            rel_path = str(dest.relative_to(_repo_root())).replace("\\", "/")
            url_path = "/" + rel_path
            return self._json(HTTPStatus.OK, {"ok": True, "path": rel_path, "url": url_path})

        if u.path == "/api/publish":
            data = self._read_json()
            message = (data.get("message") or "").strip() or "Update posts"

            status = _git(["status", "--porcelain"])
            if not (status.stdout or "").strip():
                return self._json(HTTPStatus.OK, {"ok": True, "log": "Nothing to publish (working tree clean)."})

            add = _git(["add", "-A"])
            commit = _git(["commit", "-m", message])
            if commit.returncode != 0 and "nothing to commit" in (commit.stdout + commit.stderr).lower():
                return self._json(HTTPStatus.OK, {"ok": True, "log": "Nothing to commit."})

            push = _git(["push"])
            ok = push.returncode == 0
            log = ""
            log += (add.stdout or "") + (add.stderr or "")
            log += (commit.stdout or "") + (commit.stderr or "")
            log += (push.stdout or "") + (push.stderr or "")
            return self._json(HTTPStatus.OK if ok else HTTPStatus.BAD_REQUEST, {"ok": ok, "log": log})

        if u.path == "/api/delete":
            data = self._read_json()
            rel = (data.get("path") or "").strip()
            publish = bool(data.get("publish"))
            if not rel:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "Missing path"})
            try:
                p = _safe_post_path(rel)
            except Exception:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid path"})
            if not p.exists():
                return self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

            try:
                p.unlink()
            except Exception as e:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": f"Delete failed: {e}"})

            if not publish:
                return self._json(HTTPStatus.OK, {"ok": True, "log": f"Deleted {rel} (not published)."})

            message = (data.get("message") or "").strip() or f"Delete: {p.name}"
            add = _git(["add", "-A"])
            commit = _git(["commit", "-m", message])
            push = _git(["push"])

            ok = push.returncode == 0
            log = ""
            log += (add.stdout or "") + (add.stderr or "")
            log += (commit.stdout or "") + (commit.stderr or "")
            log += (push.stdout or "") + (push.stderr or "")
            return self._json(HTTPStatus.OK if ok else HTTPStatus.BAD_REQUEST, {"ok": ok, "log": log})

        return self._json(HTTPStatus.NOT_FOUND, {"error": "Not Found"})


class WriterServer(ThreadingHTTPServer):
    # Prevent multiple writer instances from binding the same port.
    allow_reuse_address = False


def main() -> None:
    host = "127.0.0.1"
    base_port = int(os.environ.get("WRITER_PORT", "5173"))
    server = None
    port = base_port
    for _ in range(20):
        try:
            server = WriterServer((host, port), Handler)
            break
        except OSError:
            port += 1
    if server is None:
        raise RuntimeError(f"Unable to bind to ports {base_port}-{port}")

    def _open() -> None:
        webbrowser.open(f"http://{host}:{port}/", new=1, autoraise=True)

    threading.Timer(0.35, _open).start()
    print(f"Writer running on http://{host}:{port}/  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
