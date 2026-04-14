import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";
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
  CORS_ALLOW_ORIGINS?: string;
  SITE_URL?: string;
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
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      return `<pre class="hljs"><code>${hljs.highlight(code, { language, ignoreIllegals: true }).value}</code></pre>`;
    }

    if (code.trim()) {
      return `<pre class="hljs"><code>${hljs.highlightAuto(code).value}</code></pre>`;
    }

    return `<pre class="hljs"><code>${escapeCodeHtml(code)}</code></pre>`;
  },
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

function xml(body: string, init: ResponseInit = {}): Response {
  const headers = withSecurityHeaders(init.headers);
  headers.set("Content-Type", "application/xml; charset=utf-8");
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

function escapeCodeHtml(s: string): string {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

function xmlEscape(value: string): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getSiteOrigin(request: Request, env: Env): string {
  const configured = String(env.SITE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

function parseAllowedOrigins(env: Env): string[] {
  return String(env.CORS_ALLOW_ORIGINS || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildCorsHeaders(request: Request, env: Env): Headers | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  const allowed = parseAllowedOrigins(env);
  if (!allowed.length) return null;
  if (!allowed.includes(origin)) return null;

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return headers;
}

function applyCors(request: Request, env: Env, response: Response): Response {
  const cors = buildCorsHeaders(request, env);
  if (!cors) return response;
  const headers = new Headers(response.headers);
  cors.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
    blogTitle: (env.BLOG_TITLE || "zhaoxu的个人博客").trim() || "zhaoxu的个人博客",
    blogDescription: (env.BLOG_DESCRIPTION || "一个玻璃拟态 · 科技风 · 年轻化的静态博客（GitHub Pages / Jekyll）").trim(),
    authorName: (env.AUTHOR_NAME || "zhaoxu").trim() || "zhaoxu",
    profileBio: (env.PROFILE_BIO || "啥也不会的混子。").trim(),
    githubUrl: (env.GITHUB_URL || "https://github.com/zhaoxuya520").trim(),
    email: (env.EMAIL || "ww7517437@gmail.com").trim(),
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
  const isHome = !opts.title || opts.title === "首页";
  const isAi = opts.title === "AI工具";
  const isAbout = opts.title === "关于";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>${esc(fullTitle)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:title" content="${esc(fullTitle)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:type" content="website" />
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
    <link rel="stylesheet" href="/assets/css/style.min.css" />
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
    <link rel="alternate" type="application/rss+xml" title="${esc(state.siteConfig.blogTitle)} RSS" href="/rss.xml" />
    <link rel="alternate" type="application/atom+xml" title="${esc(state.siteConfig.blogTitle)} Atom" href="/atom.xml" />
    ${opts.extraHead || ""}
  </head>
  <body>
    <canvas id="stars-canvas" aria-hidden="true"></canvas>
    <div class="cursor-glow" aria-hidden="true"></div>
    <div class="scroll-progress" aria-hidden="true"></div>
    <div class="bg" aria-hidden="true"></div>
    <header class="hero-banner">
    <nav class="navbar">
      <a class="navbar-left" href="/">
        <div class="avatar">
          <img src="/assets/avatar.jpg" alt="头像" onerror="this.style.display='none'">
        </div>
        <div class="site-name">
          <span>${esc(state.siteConfig.blogTitle)}</span>
          <svg class="dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </a>

      <div class="navbar-center" id="site-nav">
        <a href="/" class="nav-item${isHome ? " active" : ""}">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          <span class="nav-text">文章</span>
        </a>
        <a href="/ai/" class="nav-item${isAi ? " active" : ""}">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
          </svg>
          <span class="nav-text">AI工具</span>
        </a>
        <a href="https://mail.linuxai.de" target="_blank" rel="noopener noreferrer" class="nav-item nav-external">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>
          <span class="nav-text">域名邮箱</span>
        </a>
        <a href="https://view.linuxai.de" target="_blank" rel="noopener noreferrer" class="nav-item nav-external">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
          </svg>
          <span class="nav-text">导航页</span>
        </a>
        <a href="/about/" class="nav-item${isAbout ? " active" : ""}">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <span class="nav-text">关于</span>
        </a>
      </div>

      <div class="navbar-right">
        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="search-input" placeholder="搜索" id="navSearch">
        </div>
        <button class="icon-btn" type="button" data-theme-toggle aria-label="切换主题" title="切换主题">
          <svg class="theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
          <svg class="theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        </button>
        <button class="hamburger" id="hamburger" aria-label="菜单" aria-expanded="false">
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>
    </nav>

    <div class="mobile-menu" id="mobileMenu">
      <a href="/" class="nav-item${isHome ? " active" : ""}">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
        <span class="nav-text">文章</span>
      </a>
      <a href="/ai/" class="nav-item${isAi ? " active" : ""}">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
        </svg>
        <span class="nav-text">AI工具</span>
      </a>
      <a href="https://mail.linuxai.de" target="_blank" rel="noopener noreferrer" class="nav-item nav-external">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
          <polyline points="22,6 12,13 2,6"></polyline>
        </svg>
        <span class="nav-text">域名邮箱</span>
      </a>
      <a href="https://view.linuxai.de" target="_blank" rel="noopener noreferrer" class="nav-item nav-external">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
        <span class="nav-text">导航页</span>
      </a>
      <a href="/about/" class="nav-item${isAbout ? " active" : ""}">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span class="nav-text">关于</span>
      </a>
    </div>
  </header>
    <main class="container content">
      ${opts.body}
    </main>
    <footer class="site-footer">
      <div class="container">
        <p class="footer-text">
          © ${new Date().getFullYear()} ${esc(state.siteConfig.blogTitle)} ·
          <a class="footer-link" href="https://github.com/zhaoxuya520/web" rel="noopener" target="_blank">GitHub</a>
        </p>
      </div>
    </footer>
    <button class="back-to-top" aria-label="返回顶部">↑</button>
    <div class="lightbox" aria-hidden="true">
      <button class="lightbox-close" aria-label="关闭">×</button>
      <img src="" alt="" />
    </div>
    <script src="/assets/js/sw-register.js" defer></script>
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

async function listPostsForFeed(env: Env, limit: number): Promise<PostRow[]> {
  const db = await dbOrThrow(env);
  const res = await db
    .prepare(
      "SELECT id, slug, title, excerpt, tags_json, cover_url, created_at, updated_at, content_md FROM posts ORDER BY created_at DESC LIMIT ?1"
    )
    .bind(limit)
    .all<PostRow>();
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
  let posts: PostListRow[] = [];
  try {
    posts = await listPosts(env, 50);
  } catch {
    posts = [];
  }

  const body = posts.length
    ? `<section class="grid">
${posts
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
    : `<section class="footer-note">
  <div class="glass panel">
    <p>还没有文章。用本地 Writer 写一篇并发布后，这里会自动更新。</p>
  </div>
</section>`;

  return html(
    layout(state, {
      title: "首页",
      description: state.siteConfig.blogDescription,
      body,
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
  const commentsBlock = `<section class="comments" aria-label="评论">
    <h2 class="comments-title">评论</h2>
    <div class="comments-body">
      <script>
        window.__giscus = {
          light: "light",
          dark: "dark_dimmed"
        };
        (function() {
          var theme = document.documentElement.dataset.theme;
          var giscusTheme = theme === 'light' ? window.__giscus.light : window.__giscus.dark;
          document.write('<script src="https://giscus.app/client.js" ' +
            'data-repo="zhaoxuya520/web" ' +
            'data-repo-id="R_kgDOQqZqlw" ' +
            'data-category="Announcements" ' +
            'data-category-id="DIC_kwDOQqZql84Cz9Un" ' +
            'data-mapping="pathname" ' +
            'data-strict="1" ' +
            'data-reactions-enabled="1" ' +
            'data-emit-metadata="0" ' +
            'data-input-position="top" ' +
            'data-theme="' + giscusTheme + '" ' +
            'data-lang="zh-CN" ' +
            'crossorigin="anonymous" async><\\/script>');
        })();
      </script>
    </div>
  </section>`;

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
  ${commentsBlock}
  <footer class="post-foot"><a class="link" href="/">← 返回列表</a></footer>
</article>`,
    })
  );
}

async function handleAbout(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

  const state = await resolveSiteState(env);
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

  const body = `<section class="about-layout">
  <aside class="about-side">
    <div class="glass panel about-side-card">
      <div class="about-avatar-wrap">
        <img class="about-avatar" src="/assets/avatar.jpg" alt="${esc(state.siteConfig.authorName)}的头像" />
      </div>
      <div class="about-name-pill">${esc(state.siteConfig.authorName)}</div>
      <div class="about-links" aria-label="联系方式">${links}</div>
    </div>
  </aside>
  <section class="about-main glass panel">
    <div class="about-section">
      <h2 class="about-h2">关于我：</h2>
      <div class="about-content"><p>${esc(state.siteConfig.profileBio)}</p></div>
    </div>
    <div class="about-section">
      <h2 class="about-h2">技能：</h2>
      <div class="skill-tags-wrapper">
        <span class="skill-tag">HTML / CSS / JavaScript</span>
        <span class="skill-tag">React / Node.js</span>
        <span class="skill-tag">Python</span>
        <span class="skill-tag">C 语言</span>
        <span class="skill-tag">Java</span>
      </div>
    </div>
    <div class="about-section">
      <h2 class="about-h2">项目：</h2>
      <ul class="project-list">
        <li>个人作品集（Portfolio）</li>
        <li>AI 聊天助手</li>
        <li>开源工具</li>
      </ul>
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

async function handleRss(request: Request, env: Env): Promise<Response> {
  const state = await resolveSiteState(env);
  const origin = getSiteOrigin(request, env);
  const posts = await listPostsForFeed(env, 20);
  const updatedAt = posts[0]?.updated_at || Date.now();

  const items = posts
    .map((post) => {
      const url = `${origin}/posts/${encodeURIComponent(post.slug)}`;
      const content = md.render(post.content_md || "");
      return `<item>
  <title>${xmlEscape(post.title)}</title>
  <link>${xmlEscape(url)}</link>
  <guid>${xmlEscape(url)}</guid>
  <pubDate>${new Date(post.created_at).toUTCString()}</pubDate>
  <description>${xmlEscape(post.excerpt || "")}</description>
  <content:encoded><![CDATA[${content}]]></content:encoded>
</item>`;
    })
    .join("\n");

  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${xmlEscape(state.siteConfig.blogTitle)}</title>
  <link>${xmlEscape(origin)}</link>
  <description>${xmlEscape(state.siteConfig.blogDescription)}</description>
  <lastBuildDate>${new Date(updatedAt).toUTCString()}</lastBuildDate>
  ${items}
</channel>
</rss>`);
}

async function handleAtom(request: Request, env: Env): Promise<Response> {
  const state = await resolveSiteState(env);
  const origin = getSiteOrigin(request, env);
  const posts = await listPostsForFeed(env, 20);
  const updatedAt = new Date(posts[0]?.updated_at || Date.now()).toISOString();

  const entries = posts
    .map((post) => {
      const url = `${origin}/posts/${encodeURIComponent(post.slug)}`;
      const content = md.render(post.content_md || "");
      return `<entry>
  <title>${xmlEscape(post.title)}</title>
  <id>${xmlEscape(url)}</id>
  <link href="${xmlEscape(url)}" />
  <updated>${new Date(post.updated_at).toISOString()}</updated>
  <published>${new Date(post.created_at).toISOString()}</published>
  <summary>${xmlEscape(post.excerpt || "")}</summary>
  <content type="html"><![CDATA[${content}]]></content>
</entry>`;
    })
    .join("\n");

  return xml(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEscape(state.siteConfig.blogTitle)}</title>
  <id>${xmlEscape(origin)}</id>
  <link href="${xmlEscape(origin)}/atom.xml" rel="self" />
  <link href="${xmlEscape(origin)}" />
  <updated>${updatedAt}</updated>
  <subtitle>${xmlEscape(state.siteConfig.blogDescription)}</subtitle>
  ${entries}
</feed>`);
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
    const isApiRequest = pathname.startsWith("/api/");

    if (isApiRequest && request.method === "OPTIONS") {
      const cors = buildCorsHeaders(request, env);
      if (!cors && request.headers.get("Origin")) {
        return json({ ok: false, error: "Origin not allowed" }, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: cors || undefined,
      });
    }

    // Try static assets first (CSS/JS/images in ./public)
    if (request.method === "GET") {
      try {
        const assetResp = await env.ASSETS.fetch(request);
        if (assetResp.status !== 404) return assetResp;
      } catch {
        // ignore and continue to dynamic routes
      }
    }

    let response: Response;

    if (pathname === "/") {
      response = await handleHome(request, env);
    } else if (pathname === "/about") {
      response = await handleAbout(request, env);
    } else if (pathname === "/ai") {
      response = await handleAi(request, env);
    } else if (pathname === "/admin") {
      response = await handleAdmin(request, env);
    } else if (pathname === "/rss.xml") {
      response = await handleRss(request, env);
    } else if (pathname === "/atom.xml") {
      response = await handleAtom(request, env);
    } else if (pathname.startsWith("/posts/")) {
      const slug = pathname.slice("/posts/".length);
      response = await handlePost(request, env, slug);
    } else if (pathname === "/api/posts") {
      if (request.method === "GET") response = await handleApiListPosts(request, env);
      else if (request.method === "POST") response = await handleApiCreatePost(request, env);
      else response = json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
    } else if (pathname.startsWith("/api/posts/")) {
      const slug = pathname.slice("/api/posts/".length);
      if (!slug) response = json({ ok: false, error: "Not Found" }, { status: 404 });
      else if (request.method === "GET") response = await handleApiGetPost(request, env, slug);
      else if (request.method === "PUT") response = await handleApiUpdatePost(request, env, slug);
      else if (request.method === "DELETE") response = await handleApiDeletePost(request, env, slug);
      else response = json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
    } else if (pathname === "/api/admin/bootstrap") {
      response = await handleApiAdminBootstrap(request, env);
    } else if (pathname === "/api/admin/session") {
      response = await handleApiAdminSession(request, env);
    } else if (pathname === "/api/admin/login") {
      response = await handleApiAdminLogin(request, env);
    } else if (pathname === "/api/admin/logout") {
      response = await handleApiAdminLogout(request);
    } else if (pathname === "/api/admin/site-config") {
      response = await handleApiAdminSiteConfig(request, env);
    } else if (pathname === "/api/admin/nav") {
      response = await handleApiAdminNavCollection(request, env);
    } else if (pathname.startsWith("/api/admin/nav/")) {
      const id = pathname.slice("/api/admin/nav/".length);
      response = await handleApiAdminNavItem(request, env, id);
    } else {
      response = await notFoundPage(env);
    }

    return isApiRequest ? applyCors(request, env, response) : response;
  },
};
