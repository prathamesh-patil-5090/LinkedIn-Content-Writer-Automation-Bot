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
3. **Today** → Generate now (or wait for the 2-hour IST cron) → edit draft → Approve / Reject / Skip
4. Approve publishes text via LinkedIn `w_member_social` and adds the post to your voice bank
5. **Runs** → history + pipeline logs

Telegram gets a ping when a draft is ready (`APP_URL` link).

## Health

- API: `GET /api/v1/health` (also `/health/live`, `/health/ready`)
- Web: `GET /api/health`

## Cron (Nest, on the API process)

The API runs its own timer (`@nestjs/schedule`). On Render Hobby the web service stays up, so slots fire without cron-job.org, Vercel cron, or Render Cron Jobs.

Slots: 07, 09, 11, 13, 15, 17, 19, 21, 23, 00 `Asia/Kolkata`. Each cron run generates a **new** story and **publishes it** (`CRON_AUTO_PUBLISH=true`) — no Approve click. Stories, source URLs, and post copy that were already used are skipped. Manual “Generate” still waits for Approve. Pause from Settings (`cronEnabled`) or set `CRON_ENABLED=false`.

Set `TZ=Asia/Kolkata` on the Render **API** service. Keep a single API instance so two processes cannot double-post.

Optional: `POST /api/v1/cron/tick` with `Authorization: Bearer <CRON_SECRET>` (add `?force=1` to ignore the window).
