# zhaoxu 的动态博客（Cloudflare Workers + D1）

本仓库已从 **GitHub Pages / Jekyll 静态博客** 重构为 **Cloudflare Workers 上的动态博客**：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zhaoxuya520/cf-workers-blog)

- **文章存储**：Cloudflare D1（SQLite）
- **服务端渲染**：Workers 运行时把 Markdown 渲染为 HTML（禁用 Markdown 内嵌 HTML，降低 XSS 风险）
- **静态资源**：`public/`（通过 Workers 静态资源能力直接提供 `/assets/*`）
- **页面路由**：
  - `/`：文章列表（支持 `?q=`、`?tag=` 简单过滤）
  - `/posts/:slug`：文章详情
  - `/about`：关于页
  - `/ai`：AI 工具页
  - `/admin`：后台管理页
- **API**：
  - `GET /api/posts`
  - `GET /api/posts/:slug`
  - `POST /api/posts`（需要 `ADMIN_TOKEN`）
  - `PUT /api/posts/:slug`（需要 `ADMIN_TOKEN`）
  - `DELETE /api/posts/:slug`（需要 `ADMIN_TOKEN`）
  - `GET /api/admin/session`
  - `POST /api/admin/login`
  - `POST /api/admin/logout`
  - `GET /api/admin/bootstrap`（需要 `ADMIN_TOKEN`）
  - `PUT /api/admin/site-config`（需要 `ADMIN_TOKEN`）
  - `POST /api/admin/nav`（需要 `ADMIN_TOKEN`）
  - `PUT /api/admin/nav/:id`（需要 `ADMIN_TOKEN`）
  - `DELETE /api/admin/nav/:id`（需要 `ADMIN_TOKEN`）

## 本地开发

```bash
npm install
```

本机运行（需要 `wrangler --local` 正常工作）：

```bash
npm run db:migrate:local
npm run dev
```

默认访问：`http://127.0.0.1:8787`

> Windows 如果 `wrangler dev --local` / `wrangler d1 ... --local` 报 `access violation`，通常是本机缺少/过旧的 **Microsoft Visual C++ Redistributable**。可先安装最新版 VC++ 运行库；或改用远端运行（需要 Cloudflare 登录）：`npx wrangler dev --remote`。

## D1 数据库初始化

1) 创建远端 D1：

```bash
npx wrangler d1 create blog
```

2) 把命令输出中的 `database_id` 填到 `wrangler.toml` 的 `[[d1_databases]] database_id`。

3) 应用迁移（远端）：

```bash
npm run db:migrate:remote
```

迁移文件在：

- `migrations/0001_init.sql`
- `migrations/0002_admin_console.sql`

## 部署到 Cloudflare Workers

```bash
npx wrangler deploy
```

设置管理员 Token（用于写入/更新文章）：

```bash
npx wrangler secret put ADMIN_TOKEN
```

设置后台登录账号：

```bash
npx wrangler secret put ADMIN_LOGIN_USERNAME
npx wrangler secret put ADMIN_LOGIN_PASSWORD
```

部署完成后可直接访问：

```text
https://<your-worker-domain>/admin
```

后台支持：

- 登录页 + 安全会话 Cookie
- 新建、编辑、删除文章
- 修改博客标题、简介、作者资料
- 管理导航链接（标题、链接、排序、新窗口打开）

## 一键部署（GitHub Actions → Cloudflare Workers）

本仓库已内置 GitHub Actions 工作流：`Deploy to Cloudflare Workers`，配置好 Secrets 后，在 GitHub 页面点一次 “Run workflow” 即可部署。

需要你在 GitHub 仓库里添加 Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

可选：

- `ADMIN_TOKEN`（用于站点写接口；建议用 `wrangler secret put ADMIN_TOKEN` 只设置在 Cloudflare 侧）
- `ADMIN_LOGIN_USERNAME`
- `ADMIN_LOGIN_PASSWORD`

使用步骤：

1) 在 Cloudflare 创建 D1 数据库，并把 `database_id` 填入 `wrangler.toml`。
2) 打开 GitHub → `Actions` → `Deploy to Cloudflare Workers` → `Run workflow`。
3) 默认会先跑 `wrangler d1 migrations apply DB --remote`，再 `wrangler deploy`（可在运行时取消勾选 migrations）。

## 通过 API 发布文章

创建文章（示例）：

```bash
curl -X POST "https://<your-worker-domain>/api/posts" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  --data "{\"title\":\"Hello\",\"contentMd\":\"# Hello\\n\\nMy first post.\",\"tags\":[\"note\"]}"
```

更新文章（示例）：

```bash
curl -X PUT "https://<your-worker-domain>/api/posts/hello" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  --data "{\"contentMd\":\"# Updated\\n\\nNew content.\"}"
```

## 目录结构

- `src/index.ts`：Worker 入口（路由 + 页面渲染 + API）
- `migrations/`：D1 迁移
- `public/assets/`：样式/脚本/图片
