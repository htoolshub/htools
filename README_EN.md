# HTools

HTools is an open-source tool directory platform powered by Cloudflare Pages Functions and D1, combining tool curation, article management, RSS aggregation, and Telegram message delivery—without a traditional server.

<p align="center">
  <a href="https://pages.cloudflare.com/"><img src="https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&amp;logoColor=white&amp;labelColor=555" alt="Cloudflare" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-2ea44f" alt="License: MIT" /></a>
  <a href="https://github.com/shaoyouvip/htools/releases/latest"><img src="https://img.shields.io/github/v/release/shaoyouvip/htools?display_name=tag" alt="Latest Release" /></a>
</p>

<p align="center">
  <a href="https://t.me/lsmkc">Telegram Channel</a> |
  <a href="https://t.me/lsmoo">Telegram Group</a>
</p>

<p align="center">
  English | <a href="README.md">简体中文</a> |
  <a href="https://blog.zrf.me/p/HTools/">Illustrated Deployment Guide</a>
</p>

## Screenshots

![HTools public tool library](public/demo/frontend-tools.png)

![HTools admin tool library](public/demo/admin-tools.png)

## Features

- **Tool directory**: category browsing, site-wide search, featured picks, and public tool submissions.
- **Content management**: articles and RSS subscription content in one dashboard, with Markdown support and conversion into site articles.
- **Telegram push**: send tools, articles, subscription items, and custom messages, then browse and update the records in one place.
- **GitHub integration**: read public repository details and auto-fill project metadata.
- **Workers AI** (optional): generate descriptions, summaries, and tags; convert common documents to Markdown.
- **ImgBed** (optional): upload images from the dashboard and fill in their public URLs automatically.
- **Data & experience**: full backup and restore, a public tool feed, Simplified Chinese / English interfaces, and light / dark themes.

## Deployment

1. Fork or import this repository into your GitHub account.
2. Create a Cloudflare Pages project and connect it to your repository.
3. Use these Pages build settings:

```txt
Build command: npm run build
Build output directory: dist
```

4. Create a Cloudflare D1 database, for example `htools`.
5. Go back to the Pages project settings and add the `DB` binding listed under "Resource Bindings" below; add the `AI` binding as well if you want Workers AI.
6. Add the required variables to the Pages deployment environment using the environment-variable table below, and store every value marked as Secret as an encrypted variable.
7. Redeploy the Pages project.
8. Open `/admin` and sign in.

The D1 schema is initialized or upgraded automatically on first API access; no manual migration command is required. The database starts empty, so import the default source from the dashboard or add tools manually.

## Resource Bindings

Add these under **Settings → Bindings** in the Pages project. Bindings are not environment variables, so they take no value:

| Variable name | Required | Type | Description |
| --- | --- | --- | --- |
| `DB` | Yes | D1 database | Select the D1 database you created; stores tools, articles, subscription content, and settings. |
| `AI` | No | Workers AI | Once bound, select a model and enable AI generation and document conversion under Admin > Service Settings. |

## Environment Variables

The application reads the following environment variables:

| Variable | Required | Recommended type | Description |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | Yes | Secret | Admin password and session-signing secret; use a unique password of at least 12 characters. |
| `GITHUB_TOKEN` | No | Secret | Raises the limit for admin-side public repository metadata requests. Use a read-only token without write, delete, or administration permissions; without it, the admin browser requests GitHub directly. |
| `IMGBED_TOKEN` | No | Secret | API token for [CloudFlare ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed). Grant only the `upload` permission, redeploy, then configure and enable the image bed under Admin > Service Settings. Uploads PNG, JPEG, WebP, GIF, or AVIF files up to 10 MB for tool previews, article covers, and Telegram push images. |
| `TURNSTILE_SITE_KEY` | No; configure together with the secret key | Plain variable | Turnstile Site Key for the administrator login page; configure it together with the secret key. |
| `TURNSTILE_SECRET_KEY` | No; configure together with the site key | Secret | Verifies Turnstile results on the server. Add the deployed domain, redeploy, then enable it in the dashboard. |
| `TGTOKEN` | No | Secret | Telegram Bot Token. After redeploying, set the recipient, test the connection, and enable it in the dashboard. Pushes are always triggered manually by an administrator. |

## Local Development

Use Node.js 22.17 or newer. Create `.dev.vars` in the project root with a local admin password, `ADMIN_PASSWORD="your-local-password"`, then run:

```bash
npm ci
npm run pages:dev
```

Open `http://127.0.0.1:8788` for the frontend, Pages Functions, and local D1. The first request initializes the database. After code changes, rerun `npm run pages:dev` to rebuild and reuse the running preview. This command uses a local AI placeholder without calling remote Workers AI.

Use `npm run dev` for frontend hot reload only; it does not serve backend APIs. `.dev.vars`, local Wrangler configuration, and database state remain untracked.

For manual D1 initialization or troubleshooting, first configure the `DB` binding in the untracked `wrangler.local.toml`:

```bash
npm run db:init:local
npm run db:init:remote
```

## Checks

```bash
npm test
npm run build
npm run test:build
npm run test:integration
```

CI runs these checks. D1 integration checks use temporary databases and random ports without Cloudflare credentials.

With Edge installed, run `npm run test:browser` to check critical flows on an isolated temporary site. With the local preview running, use `npm run test:categories` to check pagination and retries during category API failures using data simulated only in the test browser. Set `EDGE_PATH` to override the browser location. Test artifacts are stored in `tmp/`.

## Data Sources

- Default source file: [public/htools.json](public/htools.json)
- Default source URL: [https://raw.githubusercontent.com/shaoyouvip/htools/refs/heads/main/public/htools.json](https://raw.githubusercontent.com/shaoyouvip/htools/refs/heads/main/public/htools.json)
- Current site public source: `/api/htools.json`

The default source is not written to D1 automatically. Import it from the dashboard, or import another site's public `/api/htools.json`.

## SEO And Feeds

- `/sitemap.xml`: sitemap for public pages and published articles.
- `/rss.xml`: RSS feed for published articles.
- `/rss.json`: JSON Feed for published articles.
