# LinkedIn Daily Poster

Personal NestJS + Next.js app: morning tech draft in your voice → you approve → post to your LinkedIn profile.

## Stack

| Piece | Choice |
| --- | --- |
| API | NestJS (`apps/api`) |
| Web | Next.js App Router (`apps/web`) |
| Shared types | `packages/shared` |
| DB | Neon Free (prod) or Docker Postgres (local) |
| Queue/cache | Redis (Docker) |
| Images | deAPI Flux1schnell → Backblaze B2 (prod) / local `uploads` (dev) |
| LLM | Groq free API (`api.groq.com`) |

## Quick start

```bash
# 1. Env (API secrets + web public URL)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 2. Infra (Redis + optional local Postgres)
docker compose --profile local-db up -d

# 3. Install + DB
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 4. Run
pnpm dev
```

- Web: http://localhost:3000 (`WEB_PORT` in `apps/web/.env.local`)  
- API: http://localhost:3001/api/v1/health (`API_PORT` in `apps/api/.env`)  
- Login: `you@example.com` / `changeme` (change via `SEED_*` before seed)

To use other ports, set both env files and keep the URLs aligned:

```
# apps/api/.env
API_PORT=4001
APP_URL=http://localhost:4000
LINKEDIN_REDIRECT_URI=http://localhost:4001/api/v1/linkedin/oauth/callback

# apps/web/.env.local
WEB_PORT=4000
NEXT_PUBLIC_API_URL=http://localhost:4001/api/v1
```

For Neon instead of Docker Postgres, paste pooled + direct URLs into `apps/api/.env` and skip the `local-db` profile.

## Docs

See [docs/PRD.md](./docs/PRD.md) and [docs/setup-b2-telegram.md](./docs/setup-b2-telegram.md).

## Daily flow

1. **Settings** → Connect LinkedIn (OAuth) · confirm Telegram / B2 tests
2. **Voice** → keep samples active; optionally import LinkedIn `Shares.csv` / export zip
3. **Today** → Generate now (or wait for the daily IST cron) → edit draft → Approve / Reject / Skip
4. Approve publishes text via LinkedIn `w_member_social`
5. **Runs** → history + pipeline logs

Telegram gets a ping when a draft is ready (`APP_URL` link).

## What gets posted

**Two topic pillars.** Auto-picked stories come only from *AI Engineering / LLM Infrastructure* and *TypeScript / Full-Stack Systems*. Security news, CSS tips and other ecosystems are skipped for LinkedIn (the collector still stores them). The keyword lists live in `apps/api/src/content/topic-authority.ts`. A story you pick yourself with Generate is not filtered.

**Curator point of view.** A post about someone else's article or repo is written in third person and credits them by name. "We built", "our team", "I tried" are treated as fabricated and fail the quality gate. First person is only allowed when the story link is under one of your own repos in `GITHUB_REPOS`.

**Format.** 150–250 words: bold hook, one or two sentences of context, 3–4 bulleted trade-offs, a short read, a closing question. No links anywhere in the post; it ends with a name-only credit such as `Source: "Title" by author on DEV` so readers can search for it.

**Quality gate.** A draft is sent back for a rewrite (up to `MAX_REGENERATION_ATTEMPTS`) when it has a first-person claim about third-party work, a banned phrase ("Here's how we did it", "The breakthrough came when", "Takeaway:", "In today's fast-paced…"), a link, the wrong length, no bullets, or no closing question. These rules are in `apps/api/src/content/post-rules.ts` and are shared with the writer prompts. `ai-generic` is a 0–10 penalty where **lower is better**; drafts above `AI_GENERICNESS_MAX` (default 3) also go back. If the writer model fails, the run fails. There is no template post.

**Voice samples.** The writer learns rhythm from samples you added, imported, or saved with "Save to voice bank". Posts the app published on its own are stored but not fed back to the writer.

Prompts are in `prompts/` (`draft-v2.md`, `hook-v2.md`, `angle-v2.md`, `qc-v2.md`, `event-scorer-v2.md`, `voice-profile.md`).

## Health

- API: `GET /api/v1/health` (also `/health/live`, `/health/ready`)
- Web: `GET /api/health`

## Cron (Nest, on the API process)

The API runs its own timer (`@nestjs/schedule`). On Render Hobby the web service stays up, so slots fire without cron-job.org, Vercel cron, or Render Cron Jobs.

LinkedIn: **1 post/day** (max **5–7/week**) at **08:30** and **18:30** `Asia/Kolkata` (windows 08:30–10:00 · 18:30–20:00). The evening slot is a backup if morning did not publish. Each publish cron generates the **top-scored on-pillar** story (weekday rotation: Mon/Sat TypeScript, Tue/Thu/Sun AI, Wed how-to, Fri architecture) and **publishes it** (`CRON_AUTO_PUBLISH=true`) — no Approve click. Daily/weekly caps skip later ticks. A separate **6×/day** RSS collect cron (`07,10,13,16,19,22`) keeps SourceEvents fresh for surplus / X without LinkedIn self-cannibalization. Stories, source URLs, and post copy that were already used are skipped. Manual “Generate” still waits for Approve. Pause from Settings (`cronEnabled`) or set `CRON_ENABLED=false`.

Set `TZ=Asia/Kolkata` on the Render **API** service. Keep a single API instance so two processes cannot double-post.

Optional: `POST /api/v1/cron/tick` with `Authorization: Bearer <CRON_SECRET>` (add `?force=1` to ignore the window).

## Render (API) + Vercel (web)

**API** — Render Web service, root = repo root. Node `20.x`. Do not use `pnpm run dev:api`.

```
Build:  pnpm install --frozen-lockfile --prod=false && pnpm run build:api
Start:  pnpm run start:api
Health: /api/v1/health/live
```

`--prod=false` is required: Render sets `NODE_ENV=production`, which would skip Nest CLI / TypeScript and break the build.

Set on Render: `APP_URL=https://linked-in-content-writer-automation.vercel.app` (no trailing slash), `COOKIE_SAMESITE=none`, `LINKEDIN_REDIRECT_URI=https://linkedin-content-writer-automation-bot.onrender.com/api/v1/linkedin/oauth/callback`.

**Web** — Vercel, root directory `apps/web` (Include files outside the root directory: ON).

- Node.js Version: **20.x** (Project Settings → General). `apps/web` also pins `engines.node` / `.nvmrc` so Vercel does not pick 24.
- Install only needs `@ldp/web` + `@ldp/shared`, not the Nest API. That is why a full-workspace install looks like 950 packages.
- Set `NEXT_PUBLIC_API_URL=https://linkedin-content-writer-automation-bot.onrender.com/api/v1` and **redeploy** (it is baked in at build).
