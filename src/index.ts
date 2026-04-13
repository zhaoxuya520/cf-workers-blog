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
  BLOG_TITLE?: string;
  BLOG_DESCRIPTION?: string;
  AUTHOR_NAME?: string;
  PROFILE_BIO?: string;
  GITHUB_URL?: string;
  EMAIL?: string;
}

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

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

md.validateLink = (url: string) => {
  const s = (url || "").trim().toLowerCase();
  if (!s) return false;
  if (s.startsWith("javascript:")) return false;
  if (s.startsWith("data:")) return false;
  return true;
};

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

function notFoundPage(env: Env): Response {
  return html(
    layout(env, {
      title: "404",
      description: env.BLOG_DESCRIPTION,
      body: `<section class="glass panel"><h1 class="h1">404</h1><p class="muted">页面不存在。</p><p><a class="link" href="/">返回首页</a></p></section>`,
    }),
    { status: 404 }
  );
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, { status: 400 });
}

function unauthorized(): Response {
  return json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function forbidden(): Response {
  return json({ ok: false, error: "Forbidden" }, { status: 403 });
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

function layout(
  env: Env,
  opts: { title?: string; description?: string; body: string; extraHead?: string }
): string {
  const siteTitle = env.BLOG_TITLE || "Blog";
  const fullTitle = opts.title ? `${opts.title} · ${siteTitle}` : siteTitle;
  const desc = opts.description || env.BLOG_DESCRIPTION || "";
  const footerLinks = [
    `<a class="footer-link" href="/">首页</a>`,
    `<a class="footer-link" href="/about">关于</a>`,
    `<a class="footer-link" href="/ai">AI工具</a>`,
  ].join(" · ");

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
        <p class="footer-text">© ${new Date().getFullYear()} ${esc(siteTitle)} · ${footerLinks}</p>
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

function isAdmin(request: Request, env: Env): boolean {
  const required = (env.ADMIN_TOKEN || "").trim();
  if (!required) return false;
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return m[1].trim() === required;
}

async function handleHome(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

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

  const visiblePosts = posts.filter((p) => {
    const tags = parseTags(p.tags_json).map((t) => t.toLowerCase());
    if (tagFilter && !tags.includes(tagFilter)) return false;
    if (!queryFilter) return true;
    const hay = `${p.title}\n${p.excerpt || ""}`.toLowerCase();
    return hay.includes(queryFilter) || tags.some((t) => t.includes(queryFilter));
  });

  const header = `<header class="page-head">
  <h1 class="page-title">${esc(env.BLOG_TITLE || "Blog")}</h1>
  <p class="page-desc">${esc(env.BLOG_DESCRIPTION || "")}</p>
</header>`;

  const cards = dbError
    ? `<section class="glass panel">${header}<p class="muted">数据库未配置或不可用。</p><pre class="code">${esc(dbError)}</pre></section>`
    : visiblePosts.length
      ? `${header}<section class="grid" id="posts">
${visiblePosts
  .map((p) => {
    const tags = parseTags(p.tags_json);
    const tagsAttr = tags.join(",").toLowerCase();
    const tagHtml =
      tags.length > 0
        ? `<span class="dot" aria-hidden="true">·</span><span class="tags">${tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</span>`
        : "";

    const cover = p.cover_url
      ? `<div class="card-cover"><img src="${esc(p.cover_url)}" alt="${esc(p.title)}" loading="lazy"></div>`
      : "";

    return `<article class="card glass panel post-card${p.cover_url ? " has-cover" : ""}"
  data-title="${esc(p.title.toLowerCase())}"
  data-excerpt="${esc((p.excerpt || "").toLowerCase())}"
  data-tags="${esc(tagsAttr)}">
  <div class="card-content">
    <div class="meta">
      <time datetime="${esc(new Date(p.created_at).toISOString())}">${esc(formatDate(p.created_at))}</time>
      ${tagHtml}
    </div>
    <h2 class="h2"><a href="/posts/${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h2>
    <p class="excerpt">${esc(p.excerpt || "")}</p>
    <div class="footer"><a class="link" href="/posts/${encodeURIComponent(p.slug)}">阅读全文 →</a></div>
  </div>
  ${cover}
</article>`;
  })
  .join("\n")}
</section>`
      : `${header}<section class="footer-note"><div class="glass panel"><p>还没有文章。</p></div></section>`;

  return html(
    layout(env, {
      title: "首页",
      description: env.BLOG_DESCRIPTION,
      body: cards,
    })
  );
}

async function handlePost(request: Request, env: Env, slug: string): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  if (!slug) return notFoundPage(env);

  let post: PostRow | null = null;
  try {
    post = await getPostBySlug(env, slug);
  } catch (e) {
    return html(
      layout(env, {
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
    layout(env, {
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

  const name = (env.AUTHOR_NAME || "").trim() || env.BLOG_TITLE || "About";
  const bio = (env.PROFILE_BIO || "").trim() || "你好，欢迎来到我的博客。";
  const github = (env.GITHUB_URL || "").trim();
  const email = (env.EMAIL || "").trim();

  const links = [
    github
      ? `<a class="about-link icon-link" href="${esc(github)}" target="_blank" rel="noopener noreferrer"><span class="about-link-text">GitHub</span></a>`
      : "",
    email
      ? `<a class="about-link icon-link" href="mailto:${esc(email)}"><span class="about-link-text">发送邮件</span></a>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const body = `<header class="page-head">
  <h1 class="page-title">关于</h1>
  <p class="page-desc">${esc(bio)}</p>
</header>

<section class="about-layout">
  <aside class="about-side">
    <div class="glass panel about-side-card">
      <div class="about-avatar-wrap">
        <img class="about-avatar" src="/assets/avatar.jpg" alt="${esc(name)}的头像" loading="lazy" />
      </div>
      <div class="about-name-pill">${esc(name)}</div>
      <div class="about-links" aria-label="联系方式">${links}</div>
    </div>
  </aside>
  <section class="about-main glass panel">
    <div class="about-section">
      <h2 class="about-h2">简介</h2>
      <div class="about-content"><p>${esc(bio)}</p></div>
    </div>
  </section>
</section>`;

  return html(
    layout(env, {
      title: "关于",
      description: bio,
      body,
    })
  );
}

async function handleAi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });

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
    layout(env, {
      title: "AI工具",
      description: "AI 工具导航",
      body,
    })
  );
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
  if (!env.ADMIN_TOKEN || !env.ADMIN_TOKEN.trim()) return forbidden();
  if (!isAdmin(request, env)) return unauthorized();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const title = String(body?.title || "").trim();
  const contentMd = String(body?.contentMd || body?.content || "").trim();
  const tags = Array.isArray(body?.tags) ? body.tags.map((t: any) => String(t).trim()).filter(Boolean) : [];
  const coverUrl = String(body?.coverUrl || "").trim();

  if (!title) return badRequest("Missing title");
  if (!contentMd) return badRequest("Missing contentMd");

  const wantedSlug = String(body?.slug || "").trim();
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
  if (!env.ADMIN_TOKEN || !env.ADMIN_TOKEN.trim()) return forbidden();
  if (!isAdmin(request, env)) return unauthorized();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const title = body?.title != null ? String(body.title).trim() : null;
  const contentMd = body?.contentMd != null ? String(body.contentMd).trim() : body?.content != null ? String(body.content).trim() : null;
  const excerpt = body?.excerpt != null ? String(body.excerpt).trim() : null;
  const coverUrl = body?.coverUrl != null ? String(body.coverUrl).trim() : null;
  const tags = Array.isArray(body?.tags) ? body.tags.map((t: any) => String(t).trim()).filter(Boolean) : null;

  try {
    const db = await dbOrThrow(env);
    const existing = await getPostBySlug(env, slug);
    if (!existing) return json({ ok: false, error: "Not Found" }, { status: 404 });

    const nextTitle = title ?? existing.title;
    const nextContent = contentMd ?? existing.content_md;
    const nextExcerpt = excerpt ?? existing.excerpt ?? excerptFromMarkdown(nextContent);
    const nextCover = coverUrl ?? existing.cover_url;
    const nextTagsJson = tags ? JSON.stringify(tags) : existing.tags_json;

    await db
      .prepare(
        "UPDATE posts SET title=?1, excerpt=?2, tags_json=?3, cover_url=?4, content_md=?5, updated_at=?6 WHERE slug=?7"
      )
      .bind(nextTitle, nextExcerpt, nextTagsJson, nextCover, nextContent, Date.now(), slug)
      .run();

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
}

async function handleApiDeletePost(request: Request, env: Env, slug: string): Promise<Response> {
  if (request.method !== "DELETE") return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  if (!env.ADMIN_TOKEN || !env.ADMIN_TOKEN.trim()) return forbidden();
  if (!isAdmin(request, env)) return unauthorized();

  try {
    const db = await dbOrThrow(env);
    await db.prepare("DELETE FROM posts WHERE slug=?1").bind(slug).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, { status: 500 });
  }
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

    return notFoundPage(env);
  },
};
