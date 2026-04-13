const $ = (sel) => document.querySelector(sel);

const state = {
  posts: [],
  activePath: null,
};

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(input) {
  const ascii = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `post-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}`;
}

function nowDatePrefix() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowFrontMatterDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:00 +0800`;
}

function mdLite(text) {
  const lines = String(text || "").replaceAll("\r\n", "\n").split("\n");
  let html = "";
  let inCode = false;
  let codeLang = "";
  let inList = false;

  const flushList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw;

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (!inCode) {
        flushList();
        inCode = true;
        codeLang = fence[1] || "";
        html += `<pre><code data-lang="${escapeHtml(codeLang)}">`;
      } else {
        inCode = false;
        html += "</code></pre>";
      }
      continue;
    }

    if (inCode) {
      html += `${escapeHtml(line)}\n`;
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      html += `<h${level}>${inlineMd(h[2])}</h${level}>`;
      continue;
    }

    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushList();
      html += `<blockquote>${inlineMd(bq[1])}</blockquote>`;
      continue;
    }

    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) html += "<ul>";
      inList = true;
      html += `<li>${inlineMd(li[1])}</li>`;
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    flushList();
    html += `<p>${inlineMd(line)}</p>`;
  }

  flushList();
  if (inCode) html += "</code></pre>";
  return html;
}

function inlineMd(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.log || "Request failed");
  return data;
}

async function uploadImage(file) {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/upload-image", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + text + after;
  const next = start + text.length;
  textarea.selectionStart = textarea.selectionEnd = next;
  textarea.focus();
}

function renderPreview() {
  $("#preview").innerHTML = mdLite($("#md").value);
}

function renderPosts(filter = "") {
  const q = String(filter || "").trim().toLowerCase();
  const wrap = $("#posts");
  wrap.innerHTML = "";
  const list = state.posts.filter((p) => !q || String(p.title || "").toLowerCase().includes(q));
  if (!list.length) {
    wrap.innerHTML = `<div class="status">没有匹配的文章</div>`;
    return;
  }
  for (const p of list) {
    const el = document.createElement("div");
    el.className = `post ${state.activePath === p.path ? "is-active" : ""}`;
    el.innerHTML = `
      <div class="post-title">${escapeHtml(p.title || p.filename)}</div>
      <div class="post-meta">
        <span>${escapeHtml(p.date || "")}</span>
        <span>${escapeHtml(p.filename)}</span>
      </div>
    `;
    el.addEventListener("click", () => loadPost(p.path));
    wrap.appendChild(el);
  }
}

async function loadPosts() {
  const { posts } = await api("/api/posts");
  state.posts = posts || [];
  renderPosts($("#search").value);
}

async function loadStatus() {
  const s = await api("/api/status");
  const lines = [];
  lines.push(`分支: ${s.branch || "?"}`);
  lines.push(`工作区: ${s.dirty ? "有改动" : "干净"}`);
  if (s.remotes) lines.push(`远端: ${s.remotes.split("\n")[0]}`);
  $("#status").textContent = lines.join("\n");
}

async function loadPost(path) {
  const data = await api(`/api/post?path=${encodeURIComponent(path)}`);
  state.activePath = path;
  $("#deletePost").disabled = false;
  $("#filename").value = (data.path || "").split("/").pop();
  $("#title").value = data.frontMatter?.title || "";
  $("#date").value = data.frontMatter?.date || "";
  $("#tags").value = Array.isArray(data.frontMatter?.tags) ? data.frontMatter.tags.join(",") : "";
  $("#cover").value = data.frontMatter?.cover || "";
  $("#md").value = data.content || "";
  renderPreview();
  renderPosts($("#search").value);
}

function newPost() {
  state.activePath = null;
  $("#deletePost").disabled = true;
  const datePrefix = nowDatePrefix();
  const title = $("#title").value.trim() || "新文章";
  const filename = `${datePrefix}-${slugify(title)}.md`;
  $("#filename").value = filename;
  $("#date").value = nowFrontMatterDate();
  $("#tags").value = "";
  $("#cover").value = "";
  $("#md").value = "# " + title + "\n\n";
  renderPreview();
  renderPosts($("#search").value);
}

function autofill() {
  const title = $("#title").value.trim() || "新文章";
  if (!$("#filename").value.trim()) {
    $("#filename").value = `${nowDatePrefix()}-${slugify(title)}.md`;
  }
  if (!$("#date").value.trim()) $("#date").value = nowFrontMatterDate();
}

async function save() {
  autofill();
  const filename = $("#filename").value.trim();
  const tags = $("#tags").value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const cover = $("#cover").value.trim();
  const frontMatter = {
    title: $("#title").value.trim(),
    date: $("#date").value.trim(),
    tags,
  };
  if (cover) frontMatter.cover = cover;
  await api("/api/save", {
    method: "POST",
    body: JSON.stringify({ filename, frontMatter, content: $("#md").value }),
  });
  $("#log").textContent = `已保存：${filename}`;
  await loadPosts();
  await loadStatus();
}

async function publish() {
  $("#publish").disabled = true;
  try {
    const msg = `Publish: ${$("#title").value.trim() || "posts"}`;
    const res = await api("/api/publish", { method: "POST", body: JSON.stringify({ message: msg }) });
    $("#log").textContent = res.log || "发布完成";
    await loadStatus();
    await loadPosts();
  } catch (e) {
    $("#log").textContent = String(e?.message || e);
  } finally {
    $("#publish").disabled = false;
  }
}

async function deletePost() {
  if (!state.activePath) {
    $("#log").textContent = "请选择要删除的文章。";
    return;
  }
  const filename = $("#filename").value.trim() || state.activePath.split("/").pop();
  const ok = window.confirm(`确定删除这篇文章吗？\n\n${filename}\n\n将会删除文件并自动发布到博客（git push）。`);
  if (!ok) return;

  $("#deletePost").disabled = true;
  $("#publish").disabled = true;
  try {
    const res = await api("/api/delete", {
      method: "POST",
      body: JSON.stringify({ path: state.activePath, publish: true, message: `Delete: ${filename}` }),
    });
    $("#log").textContent = res.log || "删除并发布完成";
    state.activePath = null;
    $("#filename").value = "";
    $("#title").value = "";
    $("#date").value = "";
    $("#tags").value = "";
    $("#cover").value = "";
    $("#md").value = "";
    renderPreview();
    await loadStatus();
    await loadPosts();
    renderPosts($("#search").value);
  } catch (e) {
    $("#log").textContent = String(e?.message || e);
  } finally {
    $("#publish").disabled = false;
  }
}

async function insertImage() {
  const fileInput = $("#imageFile");
  fileInput.value = "";
  fileInput.click();
}

async function handleImageFile(file) {
  if (!file) return;
  $("#insertImage").disabled = true;
  try {
    const res = await uploadImage(file);
    const alt = (file.name || "image").replace(/\.[^.]+$/, "");
    const md = `\n\n![${alt}](${res.url})\n\n`;
    insertAtCursor($("#md"), md);
    renderPreview();
    $("#log").textContent = `已上传图片：${res.path}`;
    await loadStatus();
  } catch (e) {
    $("#log").textContent = String(e?.message || e);
  } finally {
    $("#insertImage").disabled = false;
  }
}

async function handleCoverFile(file) {
  if (!file) return;
  $("#uploadCover").disabled = true;
  try {
    const res = await uploadImage(file);
    $("#cover").value = res.url;
    $("#log").textContent = `已上传封面图：${res.path}`;
    await loadStatus();
  } catch (e) {
    $("#log").textContent = String(e?.message || e);
  } finally {
    $("#uploadCover").disabled = false;
  }
}

function init() {
  $("#md").addEventListener("input", renderPreview);
  $("#md").addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  $("#md").addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) handleImageFile(f);
  });
  $("#search").addEventListener("input", (e) => renderPosts(e.target.value));
  $("#newPost").addEventListener("click", () => {
    $("#title").value = "新文章";
    newPost();
  });
  $("#insertImage").addEventListener("click", insertImage);
  $("#imageFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleImageFile(f);
  });
  $("#uploadCover").addEventListener("click", () => {
    const fileInput = $("#coverFile");
    fileInput.value = "";
    fileInput.click();
  });
  $("#coverFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleCoverFile(f);
  });
  $("#format").addEventListener("click", autofill);
  $("#save").addEventListener("click", save);
  $("#publish").addEventListener("click", publish);
  $("#deletePost").addEventListener("click", deletePost);

  // initial
  renderPreview();
  loadStatus();
  loadPosts().then(() => {
    if (state.posts.length) loadPost(state.posts[0].path);
    else {
      $("#title").value = "新文章";
      newPost();
    }
  });
}

init();
