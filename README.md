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
| Images | Pixazo → Backblaze B2 (prod) / local `uploads` (dev) |
| LLM | Groq free API (`api.groq.com`) |

## Quick start

```bash
# 1. Env
cp .env.example .env

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

- Web: http://localhost:3000  
- API: http://localhost:3001/api/v1/health  
- Login: `you@example.com` / `changeme` (change via `SEED_*` before seed)

For Neon instead of Docker Postgres, paste pooled + direct URLs into `.env` and skip the `local-db` profile.

## Docs

See [docs/PRD.md](./docs/PRD.md) and [docs/setup-b2-telegram.md](./docs/setup-b2-telegram.md).

## Daily flow

1. **Settings** → Connect LinkedIn (OAuth) · confirm Telegram / B2 tests
2. **Voice** → keep samples active; optionally import LinkedIn `Shares.csv` / export zip
3. **Today** → Generate now (or wait for 07:00 IST cron) → edit draft → Approve / Reject / Skip
4. Approve publishes text via LinkedIn `w_member_social` and adds the post to your voice bank
5. **Runs** → history + pipeline logs

Telegram gets a ping when a draft is ready (`APP_URL` link).
