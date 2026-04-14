import MarkdownIt from "markdown-it";
import { nanoid } from "nanoid";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  ADMIN_TOKEN?: string;
  ADMIN_LOGIN_USERNAME?: string;
  ADMIN_LOGIN_PASSWORD?: string;
  BLOG_TITLE?: string;
  BLOG_DESCRIPTION?: string;
  AUTHOR_NAME?: string;
  PROFILE_BIO?: string;
  GITHUB_URL?: string;
  EMAIL?: string;
}

type SiteState = {
  siteConfig: SiteConfig;
  navLinks: NavLink[];
};

type SiteConfig = {
  blogTitle: string;
  blogDescription: string;
  authorName: string;
  profileBio: string;
  githubUrl: string;
  email: string;
};

type PostRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  tags_json: string;
  cover_url: string;
  content_md: string;
  created_at: number;
  updated_at: number;
};

type PostListRow = Omit<PostRow, "content_md">;

type NavLinkRow = {
  id: string;
  label: string;
  href: string;
  sort_order: number;
  open_in_new_tab: number;
  created_at: number;
  updated_at: number;
};

type NavLink = {
  id: string;
  label: string;
  href: string;
  sortOrder: number;
  openInNewTab: boolean;
};

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

md.validateLink = (url: string) => isSafeHref(url);

const SESSION_COOKIE = "blog_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

function withSecurityHeaders(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Frame-Options", "DENY");
  h.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' https: data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  return h;
}

function json(data: JsonValue, init: ResponseInit = {}): Response {
  const headers = withSecurityHeaders(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function html(body: string, init: ResponseInit = {}): Response {
  const headers = withSecurityHeaders(init.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, { status: 400 });
}

function unauthorized(): Response {
  return json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function conflict(message: string): Response {
  return json({ ok: false, error: message }, { status: 409 });
}

function stripHtml(s: string): string {
  return (s || "").replace(/<[^>]*>/g, "");
}

function excerptFromMarkdown(mdText: string): string {
  const lines = (mdText || "").split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const cleaned = t
      .replace(/^#{1,6}\s+/, "")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\[[^\]]+\]\([^)]+\)/g, (m) => m.replace(/[[\]()]/g, ""))
      .replace(/[`*_~]/g, "");
    const out = cleaned.trim();
    if (!out) continue;
    return out.length > 160 ? out.slice(0, 160) + "…" : out;
  }
  return "";
}

function slugify(input: string): string {
  const s = (input || "").trim().toLowerCase();
  const ascii = s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return ascii;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function esc(s: string): string {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const entries = header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf("=");
      return idx >= 0 ? [part.slice(0, idx), part.slice(idx + 1)] : [part, ""];
    });
  return Object.fromEntries(entries);
}

function sessionResponse(data: JsonValue, cookie: string, init: ResponseInit = {}): Response {
  const headers = withSecurityHeaders(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(data), { ...init, headers });
}

function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function signSession(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

async function createSessionToken(env: Env, username: string): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        username,
        exp: Date.now() + SESSION_TTL_MS,
      })
    )
  );
  const signature = await signSession((env.ADMIN_TOKEN || "").trim(), payload);
  return `${payload}.${signature}`;
}

async function readAdminSession(request: Request, env: Env): Promise<{ username: string } | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token || !(env.ADMIN_TOKEN || "").trim()) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = await signSession((env.ADMIN_TOKEN || "").trim(), payload);
  if (expected !== signature) return null;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { username?: string; exp?: number };
    if (!parsed.username || !parsed.exp || parsed.exp < Date.now()) return null;
    return { username: parsed.username };
  } catch {
    return null;
  }
}

function defaultSiteConfig(env: Env): SiteConfig {
  return {
    blogTitle: (env.BLOG_TITLE || "Blog").trim() || "Blog",
    blogDescription: (env.BLOG_DESCRIPTION || "").trim(),
    authorName: (env.AUTHOR_NAME || env.BLOG_TITLE || "Author").trim() || "Author",
    profileBio: (env.PROFILE_BIO || "你好，欢迎来到我的博客。").trim(),
    githubUrl: (env.GITHUB_URL || "").trim(),
    email: (env.EMAIL || "").trim(),
  };
}

function defaultNavLinks(): NavLink[] {
  return [
    { id: "nav-home-fallback", label: "首页", href: "/", sortOrder: 0, openInNewTab: false },
    { id: "nav-about-fallback", label: "关于", href: "/about", sortOrder: 10, openInNewTab: false },
    { id: "nav-ai-fallback", label: "AI工具", href: "/ai", sortOrder: 20, openInNewTab: false },
  ];
}

function isSafeHref(url: string): boolean {
  const value = (url || "").trim().toLowerCase();
  if (!value) return false;
  if (value.startsWith("javascript:") || value.startsWith("data:")) return false;
  return value.startsWith("/") || value.startsWith("#") || value.startsWith("http://") || value.startsWith("https://") || value.startsWith("mailto:");
}

function isSafeImageUrl(url: string): boolean {
  const value = (url || "").trim().toLowerCase();
  if (!value) return true;
  if (value.startsWith("javascript:")) return false;
  return value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/");
}

function navLinkAttrs(link: NavLink): string {
  return link.openInNewTab ? ` target="_blank" rel="noopener noreferrer"` : "";
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function toNavLink(row: NavLinkRow): NavLink {
  return {
    id: row.id,
    label: row.label,
    href: row.href,
    sortOrder: row.sort_order,
    openInNewTab: !!row.open_in_new_tab,
  };
}

function layout(state: SiteState, opts: { title?: string; description?: string; body: string; extraHead?: string }): string {
  const fullTitle = opts.title ? `${opts.title} · ${state.siteConfig.blogTitle}` : state.siteConfig.blogTitle;
  const desc = opts.description || state.siteConfig.blogDescription || "";
  const footerLinks = state.navLinks
    .map((link) => `<a class="footer-link" href="${esc(link.href)}"${navLinkAttrs(link)}>${esc(link.label)}</a>`)
    .join(" · ");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>${esc(fullTitle)}</title>
    <meta name="description" content="${esc(desc)}" />
    <script>
      (function() {
        var storageKey = "neonlab.theme";
        try {
          var saved = localStorage.getItem(storageKey);
          if (saved === "light" || saved === "dark") {
            document.documentElement.dataset.theme = saved;
          } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
            document.documentElement.dataset.theme = "light";
          } else {
            document.documentElement.dataset.theme = "dark";
          }
        } catch (e) {
          document.documentElement.dataset.theme = "dark";
        }
      })();
    </script>
    <link rel="stylesheet" href="/assets/css/style.css" />
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
    ${opts.extraHead || ""}
  </head>
  <body>
    <canvas id="stars-canvas" aria-hidden="true"></canvas>
    <div class="cursor-glow" aria-hidden="true"></div>
    <div class="scroll-progress" aria-hidden="true"></div>
    <div class="bg" aria-hidden="true"></div>
    <main class="container content">
      ${opts.body}
    </main>
    <footer class="site-footer">
      <div class="container">
        <p class="footer-text">© ${new Date().getFullYear()} ${esc(state.siteConfig.blogTitle)}${footerLinks ? ` · ${footerLinks}` : ""}</p>
      </div>
    </footer>
    <button class="back-to-top" aria-label="返回顶部">↑</button>
    <div class="lightbox" aria-hidden="true">
      <button class="lightbox-close" aria-label="关闭">×</button>
      <img src="" alt="" />
    </div>
    <script src="/assets/js/main.js" defer></script>
  </body>
</html>`;
}

async function dbOrThrow(env: Env): Promise<D1Database> {
  if (!env.DB) {
    throw new Error("Missing D1 binding: DB");
  }
  return env.DB;
}

async function listPosts(env: Env, limit: number): Promise<PostListRow[]> {
  const db = await dbOrThrow(env);
  const res = await db
    .prepare(
      "SELECT id, slug, title, excerpt, tags_json, cover_url, created_at, updated_at FROM posts ORDER BY created_at DESC LIMIT ?1"
    )
    .bind(limit)
    .all<PostListRow>();
  return res.results || [];
}

async function getPostBySlug(env: Env, slug: string): Promise<PostRow | null> {
  const db = await dbOrThrow(env);
  const row = await db
    .prepare(
      "SELECT id, slug, title, excerpt, tags_json, cover_url, created_at, updated_at, content_md FROM posts WHERE slug = ?1 LIMIT 1"
    )
    .bind(slug)
    .first<PostRow>();
  return row || null;
}

async function slugExists(env: Env, slug: string): Promise<boolean> {
  const db = await dbOrThrow(env);
  const row = await db
    .prepare("SELECT 1 AS ok FROM posts WHERE slug = ?1 LIMIT 1")
    .bind(slug)
    .first<{ ok: number }>();
  return !!row;
}

function parseTags(tagsJson: string): string[] {
  try {
    const v = JSON.parse(tagsJson || "[]");
    if (Array.isArray(v)) return v.map((t) => String(t)).filter(Boolean);
  } catch {}
  return [];
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index);
}

async function getSiteConfig(env: Env): Promise<SiteConfig> {
  const fallback = defaultSiteConfig(env);

  try {
    const db = await dbOrThrow(env);
    const row = await db.prepare("SELECT value_json FROM site_settings WHERE key = 'site_config' LIMIT 1").first<{ value_json: string }>();
    if (!row?.value_json) return fallback;

    const parsed = JSON.parse(row.value_json) as Partial<SiteConfig>;
    return {
      blogTitle: String(parsed.blogTitle ?? fallback.blogTitle).trim() || fallback.blogTitle,
      blogDescription: String(parsed.blogDescription ?? fallback.blogDescription).trim(),
      authorName: String(parsed.authorName ?? fallback.authorName).trim() || fallback.authorName,
      profileBio: String(parsed.profileBio ?? fallback.profileBio).trim() || fallback.profileBio,
      githubUrl: String(parsed.githubUrl ?? fallback.githubUrl).trim(),
      email: String(parsed.email ?? fallback.email).trim(),
    };
  } catch {
    return fallback;
  }
}

async function saveSiteConfig(env: Env, config: SiteConfig): Promise<void> {
  const db = await dbOrThrow(env);
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO site_settings (key, value_json, updated_at) VALUES ('site_config', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
    )
    .bind(JSON.stringify(config), now)
    .run();
}

async function listNavLinks(env: Env): Promise<NavLink[]> {
  try {
    const db = await dbOrThrow(env);
    const result = await db
      .prepare("SELECT id, label, href, sort_order, open_in_new_tab, created_at, updated_at FROM nav_links ORDER BY sort_order ASC, created_at ASC")
      .all<NavLinkRow>();
    return (result.results || []).map(toNavLink);
  } catch {
    return defaultNavLinks();
  }
}

async function createNavLink(
  env: Env,
  input: { label: string; href: string; sortOrder: number; openInNewTab: boolean }
): Promise<NavLink> {
  const db = await dbOrThrow(env);
  const now = Date.now();
  const id = nanoid(16);
  await db
    .prepare(
      "INSERT INTO nav_links (id, label, href, sort_order, open_in_new_tab, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    )
    .bind(id, input.label, input.href, input.sortOrder, boolToInt(input.openInNewTab), now, now)
    .run();

  return {
    id,
    label: input.label,
    href: input.href,
    sortOrder: input.sortOrder,
    openInNewTab: input.openInNewTab,
  };
}

async function updateNavLink(
  env: Env,
  id: string,
  input: { label: string; href: string; sortOrder: number; openInNewTab: boolean }
): Promise<NavLink | null> {
  const db = await dbOrThrow(env);
  const exists = await db.prepare("SELECT id FROM nav_links WHERE id = ?1 LIMIT 1").bind(id).first<{ id: string }>();
  if (!exists) return null;

  await db
    .prepare("UPDATE nav_links SET label = ?1, href = ?2, sort_order = ?3, open_in_new_tab = ?4, updated_at = ?5 WHERE id = ?6")
    .bind(input.label, input.href, input.sortOrder, boolToInt(input.openInNewTab), Date.now(), id)
    .run();

  return {
    id,
    label: input.label,
    href: input.href,
    sortOrder: input.sortOrder,
    openInNewTab: input.openInNewTab,
  };
}

async function deleteNavLink(env: Env, id: string): Promise<boolean> {
  const db = await dbOrThrow(env);
  const result = await db.prepare("DELETE FROM nav_links WHERE id = ?1").bind(id).run();
  return (result.meta?.changes || 0) > 0;
}

async function resolveSiteState(env: Env): Promise<SiteState> {
  const [siteConfig, navLinks] = await Promise.all([getSiteConfig(env), listNavLinks(env)]);
  return {
    siteConfig,
    navLinks,
  };
}

function hasAdminConfigured(env: Env): boolean {
  return !!(env.ADMIN_TOKEN || "").trim();
}

function hasLoginConfigured(env: Env): boolean {
  return !!(env.ADMIN_TOKEN || "").trim() && !!(env.ADMIN_LOGIN_USERNAME || "").trim() && !!(env.ADMIN_LOGIN_PASSWORD || "").trim();
}

function adminDisabled(): Response {
  return json(
    {
      ok: false,
      error: "ADMIN_TOKEN not configured. Run `wrangler secret put ADMIN_TOKEN` first.",
    },
    { status: 503 }
  );
}

function loginDisabled(): Response {
  return json(
    {
      ok: false,
      error: "Admin login is not configured. Set `ADMIN_LOGIN_USERNAME` and `ADMIN_LOGIN_PASSWORD` as Cloudflare secrets.",
    },
    { status: 503 }
  );
}

async function ensureAdmin(request: Request, env: Env): Promise<Response | null> {
  if (!hasAdminConfigured(env)) return adminDisabled();

  const session = await readAdminSession(request, env);
  if (session) return null;

  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized();
  if (match[1].trim() !== (env.ADMIN_TOKEN || "").trim()) return unauthorized();
  return null;
}

function normalizeSiteConfigInput(input: unknown, fallback: SiteConfig): SiteConfig {
  const source = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const githubUrl = String(source.githubUrl ?? fallback.githubUrl).trim();
  const email = String(source.email ?? fallback.email).trim();

  if (githubUrl && !isSafeHref(githubUrl)) {
    throw new Error("GitHub 链接格式不正确");
  }

  return {
    blogTitle: String(source.blogTitle ?? fallback.blogTitle).trim().slice(0, 120) || fallback.blogTitle,
    blogDescription: String(source.blogDescription ?? fallback.blogDescription).trim().slice(0, 280),
    authorName: String(source.authorName ?? fallback.authorName).trim().slice(0, 80) || fallback.authorName,
    profileBio: String(source.profileBio ?? fallback.profileBio).trim() || fallback.profileBio,
    githubUrl,
    email,
  };
}

function normalizeNavLinkInput(input: unknown): { label: string; href: string; sortOrder: number; openInNewTab: boolean } {
  const source = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const label = String(source.label ?? "").trim().slice(0, 40);
  const href = String(source.href ?? "").trim().slice(0, 320);
  const sortOrder = Number.parseInt(String(source.sortOrder ?? 0), 10);
  const openInNewTab = !!source.openInNewTab;

  if (!label) throw new Error("导航标题不能为空");
  if (!href) throw new Error("导航链接不能为空");
  if (!isSafeHref(href)) throw new Error("导航链接格式不正确");

  return {
    label,
    href,
    sortOrder: Number.isNaN(sortOrder) ? 0 : sortOrder,
    openInNewTab,
  };
}

function renderQuickLinks(navLinks: NavLink[]): string {
  if (!navLinks.length) return "";
  return `<section class="actions admin-actions admin-actions-compact">
${navLinks.map((link) => `<a class="btn ghost" href="${esc(link.href)}"${navLinkAttrs(link)}>${esc(link.label)}</a>`).join("\n")}
</section>`;
}

function renderTagChips(posts: PostListRow[], activeTag: string): string {
  const uniqueTags = Array.from(new Set(posts.flatMap((post) => parseTags(post.tags_json)).map((tag) => tag.trim()).filter(Boolean)));
  if (!uniqueTags.length) return "";

  return `<div class="chips">
${uniqueTags
  .map((tag) => `<a class="chip${activeTag === tag.toLowerCase() ? " is-active" : ""}" href="/?tag=${encodeURIComponent(tag)}#posts">#${esc(tag)}</a>`)
  .join("\n")}
</div>`;
}

async function notFoundPage(env: Env): Promise<Response> {
  const state = await resolveSiteState(env);
  return html(
    layout(state, {
      title: "404",
      description: state.siteConfig.blogDescription,
      body: `<section class="glass panel"><h1 class="h1">404</h1><p class="muted">页面不存在。</p><p><a class="link" href="/">返回首页</a></p></section>`,
    }),
    { status: 404 }
  );
}

async function handleHome(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

  const state = await resolveSiteState(env);
  const url = new URL(request.url);
  const tagFilter = (url.searchParams.get("tag") || "").trim().toLowerCase();
  const queryFilter = (url.searchParams.get("q") || "").trim().toLowerCase();

  let posts: PostListRow[] = [];
  let dbError = "";
  try {
    posts = await listPosts(env, 50);
  } catch (e) {
    dbError = String(e);
  }

  const visiblePosts = posts.filter((post) => {
    const tags = parseTags(post.tags_json).map((tag) => tag.toLowerCase());
    if (tagFilter && !tags.includes(tagFilter)) return false;
    if (!queryFilter) return true;
    const haystack = `${post.title}\n${post.excerpt || ""}`.toLowerCase();
    return haystack.includes(queryFilter) || tags.some((tag) => tag.includes(queryFilter));
  });

  const toolbar = !dbError
    ? `<section class="toolbar">
  <div class="glass panel toolbar-inner">
    <label class="search">
      <span class="search-icon">⌕</span>
      <input id="navSearch" type="text" placeholder="搜索文章标题、摘要或标签" value="${esc(queryFilter)}" />
    </label>
    ${renderTagChips(posts, tagFilter)}
  </div>
</section>`
    : "";

  const header = `<header class="page-head">
  <p class="badge">DYNAMIC BLOG</p>
  <h1 class="page-title">${esc(state.siteConfig.blogTitle)}</h1>
  <p class="page-desc">${esc(state.siteConfig.blogDescription)}</p>
  ${renderQuickLinks(state.navLinks)}
</header>`;

  const cards = dbError
    ? `<section class="glass panel"><p class="muted">数据库未配置或不可用。</p><pre class="code">${esc(dbError)}</pre></section>`
    : visiblePosts.length
      ? `${header}<section class="grid" id="posts">
${visiblePosts
  .map((post) => {
    const tags = parseTags(post.tags_json);
    const tagsAttr = tags.join(",").toLowerCase();
    const tagHtml =
      tags.length > 0
        ? `<span class="dot" aria-hidden="true">·</span><span class="tags">${tags.map((tag) => `<span class="tag">#${esc(tag)}</span>`).join("")}</span>`
        : "";

    const cover = post.cover_url
      ? `<div class="card-cover"><img src="${esc(post.cover_url)}" alt="${esc(post.title)}" loading="lazy"></div>`
      : "";

    return `<article class="card glass panel post-card${post.cover_url ? " has-cover" : ""}"
  data-title="${esc(post.title.toLowerCase())}"
  data-excerpt="${esc((post.excerpt || "").toLowerCase())}"
  data-tags="${esc(tagsAttr)}">
  <div class="card-content">
    <div class="meta">
      <time datetime="${esc(new Date(post.created_at).toISOString())}">${esc(formatDate(post.created_at))}</time>
      ${tagHtml}
    </div>
    <h2 class="h2"><a href="/posts/${encodeURIComponent(post.slug)}">${esc(post.title)}</a></h2>
    <p class="excerpt">${esc(post.excerpt || "")}</p>
    <div class="footer"><a class="link" href="/posts/${encodeURIComponent(post.slug)}">阅读全文 →</a></div>
  </div>
  ${cover}
</article>`;
  })
  .join("\n")}
</section>`
      : `${header}<section class="footer-note"><div class="glass panel"><p>还没有文章，现在就去后台写第一篇吧。</p><p><a class="btn primary" href="/admin">打开后台</a></p></div></section>`;

  return html(
    layout(state, {
      title: "首页",
      description: state.siteConfig.blogDescription,
      body: `${header}${toolbar}${dbError ? cards : cards.replace(header, "")}`,
    })
  );
}

async function handlePost(request: Request, env: Env, slug: string): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  if (!slug) return notFoundPage(env);

  const state = await resolveSiteState(env);
  let post: PostRow | null = null;
  try {
    post = await getPostBySlug(env, slug);
  } catch (e) {
    return html(
      layout(state, {
        title: "错误",
        body: `<section class="glass panel"><h1 class="h1">DB Error</h1><pre class="code">${esc(String(e))}</pre></section>`,
      }),
      { status: 500 }
    );
  }

  if (!post) return notFoundPage(env);

  const tags = parseTags(post.tags_json);
  const tagHtml = tags.length
    ? tags.map((t) => `<a class="tag" href="/?tag=${encodeURIComponent(t)}#posts">#${esc(t)}</a>`).join("\n")
    : "";
  const contentHtml = md.render(post.content_md || "");
  const words = stripHtml(contentHtml).trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.floor(words / 300) + 1);

  return html(
    layout(state, {
      title: post.title,
      description: stripHtml(post.excerpt || ""),
      body: `<article class="post glass panel">
  <header class="post-head">
    <p class="meta">
      <time datetime="${esc(new Date(post.created_at).toISOString())}">${esc(formatDate(post.created_at))}</time>
      <span class="dot" aria-hidden="true">·</span>
      <span class="reading-time">${readingTime} 分钟阅读</span>
      ${tags.length ? '<span class="dot" aria-hidden="true">·</span>' : ""}
      ${tagHtml}
    </p>
    <h1 class="title">${esc(post.title)}</h1>
  </header>
  <div class="prose">${contentHtml}</div>
  <footer class="post-foot"><a class="link" href="/">← 返回列表</a></footer>
</article>`,
    })
  );
}

async function handleAbout(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

  const state = await resolveSiteState(env);
  const bioHtml = md.render(state.siteConfig.profileBio || "你好，欢迎来到我的博客。");

  const links = [
    state.siteConfig.githubUrl
      ? `<a class="about-link icon-link" href="${esc(state.siteConfig.githubUrl)}" target="_blank" rel="noopener noreferrer"><span class="about-link-text">GitHub</span></a>`
      : "",
    state.siteConfig.email
      ? `<a class="about-link icon-link" href="mailto:${esc(state.siteConfig.email)}"><span class="about-link-text">发送邮件</span></a>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const body = `<header class="page-head">
  <h1 class="page-title">关于</h1>
  <p class="page-desc">${esc(state.siteConfig.blogDescription)}</p>
</header>

<section class="about-layout">
  <aside class="about-side">
    <div class="glass panel about-side-card">
      <div class="about-avatar-wrap">
        <img class="about-avatar" src="/assets/avatar.jpg" alt="${esc(state.siteConfig.authorName)}的头像" loading="lazy" />
      </div>
      <div class="about-name-pill">${esc(state.siteConfig.authorName)}</div>
      <div class="about-links" aria-label="联系方式">${links}</div>
    </div>
  </aside>
  <section class="about-main glass panel">
    <div class="about-section">
      <h2 class="about-h2">个人资料</h2>
      <div class="about-content">${bioHtml}</div>
    </div>
  </section>
</section>`;

  return html(
    layout(state, {
      title: "关于",
      description: state.siteConfig.profileBio,
      body,
    })
  );
}

async function handleAi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  const state = await resolveSiteState(env);

  const body = `<header class="page-head">
  <h1 class="page-title">AI 工具导航</h1>
  <p class="page-desc">常用大模型入口与简单介绍，点击卡片直达官网。</p>
</header>

<section class="tool-grid" aria-label="AI 工具列表">
  <a class="tool-card" href="https://chat.deepseek.com/" target="_blank" rel="noopener noreferrer">
    <span class="tool-icon-wrap" aria-hidden="true">
      <img class="tool-icon" src="https://chat.deepseek.com/favicon.ico" alt="" loading="lazy"
           onerror="this.style.display='none'; this.parentElement.classList.add('no-img');" />
      <span class="tool-fallback">DS</span>
    </span>
    <div class="tool-body">
      <div class="tool-title">DeepSeek</div>
      <div class="tool-desc">推理与代码能力强，适合做分析、总结与编程辅助。</div>
      <div class="tool-meta">chat.deepseek.com</div>
    </div>
  </a>

  <a class="tool-card" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">
    <span class="tool-icon-wrap" aria-hidden="true">
      <img class="tool-icon" src="https://chatgpt.com/favicon.ico" alt="" loading="lazy"
           onerror="this.style.display='none'; this.parentElement.classList.add('no-img');" />
      <span class="tool-fallback">CG</span>
    </span>
    <div class="tool-body">
      <div class="tool-title">ChatGPT</div>
      <div class="tool-desc">通用对话与写作/代码助手，多场景综合表现稳定。</div>
      <div class="tool-meta">chatgpt.com</div>
    </div>
  </a>

  <a class="tool-card" href="https://claude.ai/" target="_blank" rel="noopener noreferrer">
    <span class="tool-icon-wrap" aria-hidden="true">
      <img class="tool-icon" src="https://claude.ai/favicon.ico" alt="" loading="lazy"
           onerror="this.style.display='none'; this.parentElement.classList.add('no-img');" />
      <span class="tool-fallback">CL</span>
    </span>
    <div class="tool-body">
      <div class="tool-title">Claude</div>
      <div class="tool-desc">长文本理解与写作很强，适合整理文档与方案输出。</div>
      <div class="tool-meta">claude.ai</div>
    </div>
  </a>

  <a class="tool-card" href="https://gemini.google.com/" target="_blank" rel="noopener noreferrer">
    <span class="tool-icon-wrap" aria-hidden="true">
      <img class="tool-icon" src="https://gemini.google.com/favicon.ico" alt="" loading="lazy"
           onerror="this.style.display='none'; this.parentElement.classList.add('no-img');" />
      <span class="tool-fallback">GE</span>
    </span>
    <div class="tool-body">
      <div class="tool-title">Gemini</div>
      <div class="tool-desc">Google 系列模型入口，适合多模态与日常信息处理。</div>
      <div class="tool-meta">gemini.google.com</div>
    </div>
  </a>

  <a class="tool-card" href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer">
    <span class="tool-icon-wrap" aria-hidden="true">
      <img class="tool-icon" src="https://aistudio.google.com/favicon.ico" alt="" loading="lazy"
           onerror="this.style.display='none'; this.parentElement.classList.add('no-img');" />
      <span class="tool-fallback">AS</span>
    </span>
    <div class="tool-body">
      <div class="tool-title">Google AI Studio</div>
      <div class="tool-desc">官方开发/调试入口，强调可免费试用 Gemini 3 Pro（按官方额度/政策为准）。</div>
      <div class="tool-meta">aistudio.google.com</div>
    </div>
  </a>

  <a class="tool-card" href="https://grok.com/" target="_blank" rel="noopener noreferrer">
    <span class="tool-icon-wrap" aria-hidden="true">
      <img class="tool-icon" src="https://grok.com/favicon.ico" alt="" loading="lazy"
           onerror="this.style.display='none'; this.parentElement.classList.add('no-img');" />
      <span class="tool-fallback">GX</span>
    </span>
    <div class="tool-body">
      <div class="tool-title">Grok</div>
      <div class="tool-desc">xAI 的对话模型入口，偏实时问答与内容探索。</div>
      <div class="tool-meta">grok.com</div>
    </div>
  </a>

  <a class="tool-card" href="https://linux.do/" target="_blank" rel="noopener noreferrer">
    <span class="tool-icon-wrap" aria-hidden="true">
      <img class="tool-icon" src="https://linux.do/favicon.ico" alt="" loading="lazy"
           onerror="this.style.display='none'; this.parentElement.classList.add('no-img');" />
      <span class="tool-fallback">LD</span>
    </span>
    <div class="tool-body">
      <div class="tool-title">LinuxDo</div>
      <div class="tool-desc">国内最大的 AI 工具社区，讨论工具、提示词、工作流与应用落地。</div>
      <div class="tool-meta">linux.do</div>
    </div>
  </a>
</section>`;

  return html(
    layout(state, {
      title: "AI工具",
      description: "AI 工具导航",
      body,
    })
  );
}

async function handleAdmin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  const target = (await readAdminSession(request, env)) ? "/admin/index.html" : "/admin/login.html";
  const assetRequest = new Request(new URL(target, request.url).toString(), request);
  const response = await env.ASSETS.fetch(assetRequest);
  return response.status === 404 ? notFoundPage(env) : response;
}

async function handleApiAdminSession(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  const session = await readAdminSession(request, env);
  if (!session) return json({ ok: false, authenticated: false }, { status: 401 });
  return json({ ok: true, authenticated: true, username: session.username });
}

async function handleApiAdminLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  if (!hasLoginConfigured(env)) return loginDisabled();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON");
  }

  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return badRequest("用户名和密码不能为空");

  if (username !== (env.ADMIN_LOGIN_USERNAME || "").trim() || password !== (env.ADMIN_LOGIN_PASSWORD || "")) {
    return json({ ok: false, error: "用户名或密码错误" }, { status: 401 });
  }

  const token = await createSessionToken(env, username);
  return sessionResponse({ ok: true, username }, buildSessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)));
}

async function handleApiAdminLogout(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  return sessionResponse({ ok: true }, clearSessionCookie());
}

async function handleApiListPosts(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  const limitParam = new URL(request.url).searchParams.get("limit") || "50";
  const limit = Math.max(1, Math.min(200, Number(limitParam) || 50));
  try {
    const posts = await listPosts(env, limit);
    return json({
      ok: true,
      posts: posts.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        tags: parseTags(p.tags_json),
        coverUrl: p.cover_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
}

async function handleApiGetPost(request: Request, env: Env, slug: string): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  try {
    const post = await getPostBySlug(env, slug);
    if (!post) return json({ ok: false, error: "Not Found" }, { status: 404 });
    return json({
      ok: true,
      post: {
        id: post.id,
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        tags: parseTags(post.tags_json),
        coverUrl: post.cover_url,
        contentMd: post.content_md,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
}

async function handleApiCreatePost(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

  const denied = await ensureAdmin(request, env);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON");
  }

  const title = String(body.title || "").trim();
  const contentMd = String(body.contentMd || body.content || "").trim();
  const tags = normalizeTags(body.tags);
  const coverUrl = String(body.coverUrl || "").trim();

  if (!title) return badRequest("Missing title");
  if (!contentMd) return badRequest("Missing contentMd");
  if (!isSafeImageUrl(coverUrl)) return badRequest("coverUrl 格式不正确");

  const wantedSlug = slugify(String(body.slug || "").trim());
  let slug = wantedSlug || slugify(title);
  if (!slug) slug = `post-${nanoid(10)}`;

  try {
    if (await slugExists(env, slug)) return conflict("Slug already exists");
    const now = Date.now();
    const excerpt = String(body?.excerpt || "").trim() || excerptFromMarkdown(contentMd);
    const id = nanoid(16);
    const db = await dbOrThrow(env);
    await db
      .prepare(
        "INSERT INTO posts (id, slug, title, excerpt, tags_json, cover_url, content_md, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
      )
      .bind(id, slug, title, excerpt, JSON.stringify(tags), coverUrl, contentMd, now, now)
      .run();

    return json({ ok: true, id, slug });
  } catch (e) {
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
}

async function handleApiUpdatePost(request: Request, env: Env, slug: string): Promise<Response> {
  if (request.method !== "PUT") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

  const denied = await ensureAdmin(request, env);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    const db = await dbOrThrow(env);
    const existing = await getPostBySlug(env, slug);
    if (!existing) return json({ ok: false, error: "Not Found" }, { status: 404 });

    const nextTitle = body.title != null ? String(body.title).trim() : existing.title;
    const nextContent =
      body.contentMd != null ? String(body.contentMd).trim() : body.content != null ? String(body.content).trim() : existing.content_md;
    const nextExcerpt = body.excerpt != null ? String(body.excerpt).trim() : existing.excerpt;
    const nextCover = body.coverUrl != null ? String(body.coverUrl).trim() : existing.cover_url;
    const nextTags = body.tags != null ? normalizeTags(body.tags) : parseTags(existing.tags_json);
    const requestedSlug = body.slug != null ? slugify(String(body.slug).trim()) : existing.slug;
    const nextSlug = requestedSlug || slugify(nextTitle) || existing.slug;

    if (!nextTitle) return badRequest("Missing title");
    if (!nextContent) return badRequest("Missing contentMd");
    if (!isSafeImageUrl(nextCover)) return badRequest("coverUrl 格式不正确");

    if (nextSlug !== existing.slug && (await slugExists(env, nextSlug))) {
      return conflict("Slug already exists");
    }

    await db
      .prepare(
        "UPDATE posts SET slug=?1, title=?2, excerpt=?3, tags_json=?4, cover_url=?5, content_md=?6, updated_at=?7 WHERE slug=?8"
      )
      .bind(nextSlug, nextTitle, nextExcerpt || excerptFromMarkdown(nextContent), JSON.stringify(nextTags), nextCover, nextContent, Date.now(), slug)
      .run();

    return json({ ok: true, slug: nextSlug });
  } catch (e) {
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
}

async function handleApiDeletePost(request: Request, env: Env, slug: string): Promise<Response> {
  if (request.method !== "DELETE") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

  const denied = await ensureAdmin(request, env);
  if (denied) return denied;

  try {
    const db = await dbOrThrow(env);
    await db.prepare("DELETE FROM posts WHERE slug=?1").bind(slug).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
}

async function handleApiAdminBootstrap(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

  const denied = await ensureAdmin(request, env);
  if (denied) return denied;

  try {
    const [state, posts] = await Promise.all([resolveSiteState(env), listPosts(env, 200)]);
    return json({
      ok: true,
      siteConfig: state.siteConfig,
      navLinks: state.navLinks,
      posts: posts.map((post) => ({
        id: post.id,
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        tags: parseTags(post.tags_json),
        coverUrl: post.cover_url,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
      })),
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
}

async function handleApiAdminSiteConfig(request: Request, env: Env): Promise<Response> {
  const denied = await ensureAdmin(request, env);
  if (denied) return denied;

  if (request.method === "GET") {
    try {
      const siteConfig = await getSiteConfig(env);
      return json({ ok: true, siteConfig });
    } catch (e) {
      return json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  if (request.method !== "PUT") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

  try {
    const current = await getSiteConfig(env);
    const payload = await request.json();
    const next = normalizeSiteConfigInput(payload, current);
    await saveSiteConfig(env, next);
    return json({ ok: true, siteConfig: next });
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : String(e));
  }
}

async function handleApiAdminNavCollection(request: Request, env: Env): Promise<Response> {
  const denied = await ensureAdmin(request, env);
  if (denied) return denied;

  if (request.method === "GET") {
    try {
      return json({ ok: true, navLinks: await listNavLinks(env) });
    } catch (e) {
      return json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

  try {
    const input = normalizeNavLinkInput(await request.json());
    const navLink = await createNavLink(env, input);
    return json({ ok: true, navLink });
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : String(e));
  }
}

async function handleApiAdminNavItem(request: Request, env: Env, id: string): Promise<Response> {
  const denied = await ensureAdmin(request, env);
  if (denied) return denied;

  if (!id) return json({ ok: false, error: "Not Found" }, { status: 404 });

  if (request.method === "PUT") {
    try {
      const input = normalizeNavLinkInput(await request.json());
      const navLink = await updateNavLink(env, id, input);
      if (!navLink) return json({ ok: false, error: "Not Found" }, { status: 404 });
      return json({ ok: true, navLink });
    } catch (e) {
      return badRequest(e instanceof Error ? e.message : String(e));
    }
  }

  if (request.method === "DELETE") {
    try {
      const deleted = await deleteNavLink(env, id);
      if (!deleted) return json({ ok: false, error: "Not Found" }, { status: 404 });
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}

function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  if (pathname !== "/" && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);

    // Try static assets first (CSS/JS/images in ./public)
    if (request.method === "GET") {
      try {
        const assetResp = await env.ASSETS.fetch(request);
        if (assetResp.status !== 404) return assetResp;
      } catch {
        // ignore and continue to dynamic routes
      }
    }

    // Pages
    if (pathname === "/") return handleHome(request, env);
    if (pathname === "/about") return handleAbout(request, env);
    if (pathname === "/ai") return handleAi(request, env);
    if (pathname === "/admin") return handleAdmin(request, env);
    if (pathname.startsWith("/posts/")) {
      const slug = pathname.slice("/posts/".length);
      return handlePost(request, env, slug);
    }

    // API
    if (pathname === "/api/posts") {
      if (request.method === "GET") return handleApiListPosts(request, env);
      if (request.method === "POST") return handleApiCreatePost(request, env);
      return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
    }

    if (pathname.startsWith("/api/posts/")) {
      const slug = pathname.slice("/api/posts/".length);
      if (!slug) return json({ ok: false, error: "Not Found" }, { status: 404 });
      if (request.method === "GET") return handleApiGetPost(request, env, slug);
      if (request.method === "PUT") return handleApiUpdatePost(request, env, slug);
      if (request.method === "DELETE") return handleApiDeletePost(request, env, slug);
      return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
    }

    if (pathname === "/api/admin/bootstrap") return handleApiAdminBootstrap(request, env);
    if (pathname === "/api/admin/session") return handleApiAdminSession(request, env);
    if (pathname === "/api/admin/login") return handleApiAdminLogin(request, env);
    if (pathname === "/api/admin/logout") return handleApiAdminLogout(request);
    if (pathname === "/api/admin/site-config") return handleApiAdminSiteConfig(request, env);
    if (pathname === "/api/admin/nav") return handleApiAdminNavCollection(request, env);
    if (pathname.startsWith("/api/admin/nav/")) {
      const id = pathname.slice("/api/admin/nav/".length);
      return handleApiAdminNavItem(request, env, id);
    }

    return notFoundPage(env);
  },
};
