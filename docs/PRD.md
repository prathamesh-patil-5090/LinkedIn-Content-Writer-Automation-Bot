# Product Requirements Document

**Product:** LinkedIn Daily Poster (personal)
**Owner:** You (single user)
**Status:** Draft for build
**Date:** 12 August 2026
**Stack:** NestJS (API + workers) · Next.js (App Router, dashboard) · Neon Postgres (free, no expiry) · Redis · Backblaze B2

This is a **personal tool**, not a company product, not Unovative software, and not something other people will log into. You use it to draft and publish posts on **your own LinkedIn profile**.

---

## 1. Summary

Replace the n8n prototype with a private app that:

1. Collects technology news every morning (IST).
2. Researches and ranks stories for **your** LinkedIn audience (founders, product builders, Indian/Vietnamese startups).
3. Writes a LinkedIn post in **your voice**, using stored real post samples (few-shot), not a generic “founder” prompt.
4. Generates a supporting image.
5. **Waits for you to approve** in the web app (and optionally Telegram).
6. Publishes to **your personal LinkedIn profile** only after Approve. Reject regenerates a new draft from the same story + feedback.

The n8n graph is the functional spec. NestJS + Next.js is the app you run: inspectable drafts, editable voice bank, audit log, and no fragile canvas wiring.

---

## 2. Problem

| Today (n8n)                              | Pain                                                   |
| ---------------------------------------- | ------------------------------------------------------ |
| Logic lives in a JSON canvas             | Hard to review, version, test, or onboard              |
| Voice samples stuffed in a Set node      | Easy to lose; not a first-class dataset                |
| Telegram is the only UI                  | No draft history, no edit-before-publish, no analytics |
| Credentials scattered on nodes           | Painful to keep a personal setup running               |
| Regenerating loops back into Image Agent | Confusing graph; easy to publish the _old_ draft       |

You need a **knowledgeable daily LinkedIn post** that sounds like you, with a confirmation gate, without living inside n8n.

---

## 3. Goals and non-goals

### Goals (v1)

- Daily 07:00 IST run, plus manual “Run now”.
- Pipeline: Research → Rank → 3 drafts → Founder voice → Image → Approval → Publish or Regenerate.
- Voice mimicry from **your real posts** stored in the database (seeded from `prompts/voice-samples.md`, then grown from your LinkedIn archive + posts this app publishes).
- You always approve or reject (optional written feedback). Never auto-publish.
- Dashboard: today’s draft, history, voice samples CRUD, run logs.
- Posts only to **your personal LinkedIn profile** (`w_member_social` only).

### Non-goals (v1)

- Not a company / Unovative product. No teammates, no clients, no “operator” role.
- Multi-platform factory (X thread, Instagram, YouTube Shorts, newsletter, SEO article).
- Company-page posting (`w_organization_social`). Personal profile only.
- Public or multi-tenant SaaS. One login: yours.
- Training a custom LLM / LoRA on your voice (few-shot via Groq free models is v1).
- Scraping LinkedIn (your profile, other people’s posts, or “300+ sources”). News comes from RSS. Voice comes from **your** posts via official export or this app’s own publish history — never by scraping linkedin.com.

---

## 4. Who uses it

You. One login, one LinkedIn account. The scheduler and models run in the background.

v1: email/password (or magic-link) so the dashboard is not open on the internet. No roles, no team workspace.

---

## 5. Journeys

### 5.1 Morning approval (happy path)

1. 07:00 IST job starts a **Run**.
2. Backend collects RSS, ranks one story, writes a post in your voice + image.
3. You open the app (or Telegram) and see hook, full post, source, image.
4. You tap **Approve**. Backend publishes to your LinkedIn profile and marks the run `published`.
5. You see confirmation + LinkedIn post URL if the API returns one.

### 5.2 Reject and regenerate

1. You tap **Reject**, optionally type feedback (“sharper, less generic, more product psychology”).
2. Backend regenerates post + image from the **same winning story** + feedback + voice samples.
3. New draft appears for approval. Repeat until Approve or **Skip today**.

### 5.3 Edit then publish

1. On the draft screen, you edit `post_text` (and optionally hook).
2. **Approve** publishes the **edited** text, not the raw model output.

### 5.4 Voice bank

1. You open **Voice**.
2. You paste another real LinkedIn post as a sample (title + body), **or** upload LinkedIn’s official data archive (`Shares.csv` / the zip from Settings → Data privacy → Download your data).
3. The app extracts your post texts, lets you tick which ones to keep (skip short/repost/empty), and saves them as `voice_samples`.
4. Next run includes the new samples in the voice prompt.

After you Approve a draft, you can also **Save as voice sample** so future posts learn from what you actually shipped.

### 5.5 Manual run

1. From **Today**, you click **Generate now** (e.g. after adding samples or if the cron missed).
2. Same pipeline as cron; concurrent runs for the same day are blocked.

---

## 6. Functional requirements

### 6.1 News collection

- Fetch at least four feeds (v1 defaults: TechCrunch, The Verge, Hacker News frontpage, Wired).
- Normalize title, link, summary, published_at, source host.
- Dedupe by URL + normalized title.
- Cap at ~40 stories per run before the research LLM.
- Sources are configurable in DB (`news_sources`), not hardcoded only.

### 6.2 Research agent

- Input: collected stories JSON.
- Output: top 10 with `rank`, `title`, `link`, `why_it_matters`, `trend_score`, `angle`.
- Bias: **your** topics — product, SaaS, apps, UX, shipping, India/SE Asia builders, applied AI. Skip gossip and hype-only fundraising.

### 6.3 Ranking agent

- Pick **one** winner from the top 10.
- Persist winner + runners-up on the Run for transparency in the UI.

### 6.4 Content agent

- Produce three drafts: `operator_playbook`, `journey_lesson`, `product_insight`.
- Store all three; UI can show “other angles” as collapsed extras.

### 6.5 Voice agent

- Rewrite the best draft as **one** final post in your voice.
- **Must** inject `voice_samples` (active samples, newest first, cap ~4–8 to stay in context).
- Rules: no fake company metrics, no brochure tone, 180–280 words, LinkedIn line breaks.
- Output JSON: `post_text`, `hook`, `image_prompt`, `hashtags`, `chosen_style`, `source_title`, `source_link`.

### 6.6 Image agent

- Generate **1024×1024** from `image_prompt` via **Pixazo free image APIs** (not OpenAI / DALL·E).
- v1 primary: **Flux 1 Schnell** (`POST https://gateway.pixazo.ai/flux-1-schnell/v1/getData`). Auth header `Ocp-Apim-Subscription-Key`. Body: `prompt`, `width`, `height`, optional `num_steps` (4) and `seed`.
- Response is `{ "output": "<cdn url>" }`. Download the file and store it on **Backblaze B2** (S3-compatible API); local `./uploads` in dev only. Persist the B2 public URL on the draft. Do not hotlink the Pixazo CDN long-term.
- Fallback if Schnell is down or rate-limited: **SDXL v1.0** (`POST https://gateway.pixazo.ai/getImage/v1/getSDXLImage`), same 1024×1024. Do not use SD 1.5 as primary (max 512×512).
- If image gen fails, continue the run: draft stays pending with no image; UI shows “image unavailable”. Never block approval on image failure.
- v1: image is for review; LinkedIn publish may be **text-only** if media upload is not ready. UI must show this clearly.
- v1.1: LinkedIn image upload (register upload → binary → create post with media).

### 6.7 Approval

- States: `pending_approval` → `approved` | `rejected` | `skipped`.
- Approve uses **current** `post_text` (after any human edits).
- Reject requires optional `feedback` string; creates a new draft version on the same run.
- Skip today: no publish, no further regen.
- Timeout: if no action in 24h, run stays `pending_approval` (no auto-publish). Optional reminder notification.

### 6.8 LinkedIn publish

- OAuth2 for **your personal profile** only.
- Scopes: Sign In + Share on LinkedIn (`w_member_social`). Organization / company-page support **off**.
- After publish: store `linkedin_post_id` / URN, timestamp, raw API response (redacted).
- Failures: surface error in UI; do not mark published.

### 6.9 Notifications (optional v1)

- Telegram send-and-wait **or** simple “draft ready” message with a link to the Next.js draft URL.
- Preferred v1: **in-app is source of truth**; Telegram is a ping + deep link. Avoid duplicating n8n’s wait-node complexity unless needed.

### 6.10 Runs and audit

- Every cron/manual trigger creates a `Run` with status machine (see data model).
- Persist raw LLM JSON per step for debugging (not shown in the default UI).
- Dashboard list: date, winner title, status, published at.

### 6.11 Voice import (your previous LinkedIn posts)

The posting OAuth we use (`w_member_social`) **cannot read** your old posts. LinkedIn’s read scope `r_member_social` exists on paper (`GET /rest/posts?q=author&author=urn:li:person:{id}`) but is a **closed permission** — they are not accepting access requests ([Marketing API FAQ](https://learn.microsoft.com/en-us/linkedin/marketing/lms-faq)). Scraping your activity feed is against LinkedIn ToS and is a non-goal.

v1 therefore loads voice from three **allowed** sources:

| Source | How | When |
| ------ | --- | ---- |
| Seed file | `prompts/voice-samples.md` | First run / empty DB |
| Official archive | You download your data from LinkedIn and upload `Shares.csv` (or the zip) in `/voice` | Best way to get historical posts |
| This app | After Approve, optional “Save as voice sample”; published `drafts.post_text` is already yours | Ongoing, no extra LinkedIn read |

**Archive import rules**

- LinkedIn path: Me → Settings & Privacy → Data privacy → Download your data. Pick posts/shares (minutes) or the larger archive (~24h). File is typically `Shares.csv` inside the zip. Docs: [Download your data](https://www.linkedin.com/help/linkedin/answer/a1339364).
- Parse share text; skip empty, very short (< ~400 chars), and obvious reshares with no original commentary.
- Dedupe against existing `voice_samples.body` (normalized whitespace).
- Default: import as `is_active=true`, `source=linkedin_export`. You can deactivate junk in the UI.
- Cap used in the prompt remains ~4–8 newest active samples (not all 200 posts). Extra samples stay in the bank for you to curate.
- Never fetch other members’ posts. Archive is **your** data only.

v1.1 (if LinkedIn ever opens `r_member_social`): Settings → “Sync my posts” using `GET /rest/posts?q=author`. Until then, do not request that scope; OAuth stays Sign In + `w_member_social`.

---

## 7. Information architecture (Next.js)

| Route               | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `/login`            | Auth                                                                    |
| `/`                 | Today: current run, draft, Approve / Reject / Skip, Generate now        |
| `/runs`             | History table                                                           |
| `/runs/[id]`        | Full run: stories, ranking, three drafts, versions, logs                |
| `/voice`            | CRUD voice samples; **Import LinkedIn archive**; token-use preview          |
| `/settings`         | LinkedIn connect, Telegram chat id, cron enabled, timezone, RSS sources |
| `/settings/sources` | Enable/disable RSS URLs                                                 |

**Today screen (primary):**

- Status pill (Generating / Awaiting approval / Published / Rejected / Failed)
- Hook + full post in an editable textarea
- Source title + link
- Image preview
- Chosen style
- Actions: Approve, Reject (opens feedback), Skip
- If generating: progress steps (Collect → Research → Rank → Write → Image)

---

## 8. Architecture

```
Next.js (App Router)
  └── REST/JSON to NestJS  (session cookie or JWT)

NestJS
  ├── AuthModule
  ├── RunsModule          # CRUD + generate/approve/reject
  ├── PipelineModule      # orchestrates agents
  ├── NewsModule          # RSS fetch + normalize
  ├── VoiceModule         # samples CRUD
  ├── LinkedInModule      # OAuth + posts
  ├── MediaModule         # image gen + storage
  ├── NotificationsModule # Telegram optional
  └── SchedulerModule     # @Cron 07:00 Asia/Kolkata

Workers (same Nest process v1, BullMQ v1.1)
  └── pipeline queue: one job per run

PostgreSQL (Neon Free in prod; Docker locally)
Redis (queue + optional cache; Docker locally / in-process v1)
Backblaze B2 (images)
Groq API (chat — free tier, OpenAI-compatible)
Pixazo API (images — Flux Schnell / SDXL free)
LinkedIn REST API
```

**Pipeline as code (mirrors n8n, testable):**

```
collectNews → researchTop10 → rankWinner → writeThreeDrafts
  → applyVoice(samples) → generateImage → notifyPending
```

Reject path:

```
regenerateVoice(winner + feedback + samples) → generateImage → notifyPending
```

Do **not** re-fetch news on reject. Same `run_id`, new `draft_version`.

---

## 9. Data model (PostgreSQL)

### `users`

id, email, password_hash, created_at

### `linkedin_connections`

user_id, access_token (encrypted), refresh_token (encrypted), expires_at, person_urn, connected_at

### `voice_samples`

id, title, body, source_url nullable, source (`manual` \| `linkedin_export` \| `published_by_app`), is_active, sort_order, created_at
Seed from `prompts/voice-samples.md` (4 samples). Import later from LinkedIn `Shares.csv`.

### `news_sources`

id, name, rss_url, is_active, created_at

### `runs`

| Column                  | Notes                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                      | uuid                                                                                                                                                                 |
| triggered_by            | `cron` \| `manual`                                                                                                                                                   |
| status                  | `collecting` \| `researching` \| `ranking` \| `writing` \| `imaging` \| `pending_approval` \| `publishing` \| `published` \| `regenerating` \| `skipped` \| `failed` |
| collected_at            | timestamptz                                                                                                                                                          |
| story_count             | int                                                                                                                                                                  |
| winner_json             | jsonb (title, link, angle, …)                                                                                                                                        |
| top_stories_json        | jsonb                                                                                                                                                                |
| error_message           | text nullable                                                                                                                                                        |
| published_at            | timestamptz nullable                                                                                                                                                 |
| linkedin_post_urn       | text nullable                                                                                                                                                        |
| created_at / updated_at |                                                                                                                                                                      |

Unique constraint: at most one **in-flight** run (`pending_approval` or generating statuses). Allow many historical runs per day.

### `drafts`

| Column                     | Notes                                                 |
| -------------------------- | ----------------------------------------------------- |
| id                         | uuid                                                  |
| run_id                     | fk                                                    |
| version                    | int, starts at 1                                      |
| chosen_style               | text                                                  |
| hook                       | text                                                  |
| post_text                  | text (human-editable)                                 |
| image_prompt               | text                                                  |
| image_url                  | text                                                  |
| hashtags                   | text[]                                                |
| source_title / source_link |                                                       |
| three_drafts_json          | jsonb (content agent output)                          |
| status                     | `pending` \| `approved` \| `superseded` \| `rejected` |
| feedback                   | text (on reject)                                      |
| created_at                 |                                                       |

Latest pending draft is what `/` shows.

### `pipeline_logs`

run_id, step (`research` \| `rank` \| `content` \| `voice` \| `image` \| `linkedin`), input_excerpt, output_json, latency_ms, created_at

### `settings` (key-value or single row)

timezone default `Asia/Kolkata`, cron_enabled, telegram_chat_id, telegram_enabled

---

## 10. API (NestJS)

Base: `/api/v1`
Auth: session cookie (httpOnly) on all except login and LinkedIn OAuth callback.

| Method | Path                       | Purpose                                   |
| ------ | -------------------------- | ----------------------------------------- |
| POST   | `/auth/login`              | Email + password                          |
| POST   | `/auth/logout`             |                                           |
| GET    | `/me`                      | Current user + LinkedIn connected?        |
| GET    | `/runs/today`              | Latest run + current draft                |
| GET    | `/runs`                    | Paginated history                         |
| GET    | `/runs/:id`                | Full run + drafts + logs                  |
| POST   | `/runs`                    | Manual generate (409 if one in flight)    |
| PATCH  | `/runs/:id/draft`          | Save edited post_text / hook              |
| POST   | `/runs/:id/approve`        | Publish current draft                     |
| POST   | `/runs/:id/reject`         | Body `{ feedback?: string }` → regenerate |
| POST   | `/runs/:id/skip`           | Skip today                                |
| GET    | `/voice-samples`           | List                                      |
| POST   | `/voice-samples`           | Create (paste)                            |
| POST   | `/voice-samples/import`    | Upload LinkedIn `Shares.csv` or data zip  |
| POST   | `/runs/:id/save-voice`     | Copy approved/published draft into bank   |
| PATCH  | `/voice-samples/:id`       | Update / deactivate                       |
| DELETE | `/voice-samples/:id`       |                                           |
| GET    | `/settings`                |                                           |
| PATCH  | `/settings`                |                                           |
| GET    | `/news-sources`            |                                           |
| PUT    | `/news-sources`            | Replace list                              |
| GET    | `/linkedin/oauth/start`    | Redirect                                  |
| GET    | `/linkedin/oauth/callback` | Persist tokens                            |
| DELETE | `/linkedin/connection`     | Disconnect                                |

**Approve contract:** always publish `drafts.post_text` after PATCH, never a stale LLM buffer.

**SSE or polling:** `GET /runs/:id` polled every 2s while status is generating. SSE is nice-to-have.

---

## 11. Tech choices

| Layer    | Choice                                           | Why                                                                        |
| -------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| API      | NestJS 10+, TypeScript                           | Modules map 1:1 to pipeline agents                                         |
| ORM      | Prisma                                           | Fast schema + migrations                                                   |
| DB       | Neon Postgres (free) in prod; Docker Postgres locally | Permanent free plan; Prisma `DATABASE_URL` + `DIRECT_URL` |
| Queue    | BullMQ + Redis                                   | Durable generate/publish jobs (in-process async acceptable for MVP week 1) |
| Frontend | Next.js 15 App Router                            | Dashboard + server actions calling Nest, or BFF                            |
| UI       | Tailwind + shadcn/ui                             | Simple personal dashboard                                                  |
| Auth     | Nest sessions or JWT in httpOnly cookie          | Just you                                                                   |
| LLM      | Groq free API (OpenAI-compatible)                | Free key from [console.groq.com](https://console.groq.com); pin model IDs in env |
| Image    | Pixazo Flux 1 Schnell (free), SDXL fallback      | 1024×1024; key from [api-console.pixazo.ai](https://api-console.pixazo.ai/api_keys) |
| LinkedIn | HTTP to `https://api.linkedin.com/rest/posts`    | Native n8n node is flaky; version header required                          |
| Storage  | Backblaze B2 (S3-compatible); local `./uploads` in dev | Persist downloaded Pixazo output, not the CDN URL                    |
| Monorepo | `apps/api`, `apps/web`, `packages/shared` (pnpm) | Shared types for Run/Draft                                                 |

**Frontend talks only to NestJS.** Do not call Groq, Pixazo, or LinkedIn from the browser.

### 11.1 Groq (chat agents)

Base URL: `https://api.groq.com/openai/v1` (OpenAI SDK drop-in). Auth: `Authorization: Bearer $GROQ_API_KEY`. Create a free key at [console.groq.com](https://console.groq.com).

Pin model IDs in env. On failure, try `LLM_FALLBACKS` in order.

| Step | Primary | Fallback | Why |
| ---- | ------- | -------- | --- |
| Research | `llama-3.3-70b-versatile` | `openai/gpt-oss-20b` | Strong JSON + ranking context |
| Rank | `openai/gpt-oss-20b` | `llama-3.3-70b-versatile` | Fast structured pick |
| Content (3 drafts) | `llama-3.3-70b-versatile` | `llama-3.1-8b-instant` | Prose quality |
| Founder voice | `llama-3.3-70b-versatile` | `openai/gpt-oss-20b` | Few-shot rewrite + JSON mode |

Simplest v1 (one model for all four steps): `llama-3.3-70b-versatile`.

Force JSON with `response_format: { "type": "json_object" }`. Parse with zod. Include the word “JSON” in system prompts.

**Rate limits:** Groq free tier is RPM/TPM per model (see console). A daily run is ~4 chat calls plus 1–2 on reject — fine for personal use.

### 11.2 Pixazo (images)

Key: [api-console.pixazo.ai/api_keys](https://api-console.pixazo.ai/api_keys). Header: `Ocp-Apim-Subscription-Key`. Docs: [pixazo.ai/api/free](https://www.pixazo.ai/api/free).

| Role | Model | Endpoint | Size |
| ---- | ----- | -------- | ---- |
| Primary | Flux 1 Schnell (free) | `POST https://gateway.pixazo.ai/flux-1-schnell/v1/getData` | 1024×1024 (defaults) |
| Fallback | SDXL v1.0 (free) | `POST https://gateway.pixazo.ai/getImage/v1/getSDXLImage` | 1024×1024 |

Flux Schnell is free during preview with a fair-use cap of **60 RPM**. If Pixazo returns 429/5xx, retry once then fall back to SDXL; if both fail, continue without an image.

### 11.3 Hosting: Neon Postgres + Backblaze B2

**Postgres — [Neon Free](https://neon.com/docs/introduction/plans)** (does **not** expire)

Render Free Postgres expires after 30 days and then deletes the data. Do not use it for this app.

| Host | Expires? | Idle behavior | Storage | Verdict |
| ---- | -------- | ------------- | ------- | ------- |
| **Neon Free** | No (permanent plan, no card) | Sleeps after 5 min; **auto-wakes** on the next query (~0.5–1s) | 0.5 GB / project | **Use this** |
| Aiven Free | No time limit | Powers off after inactivity (you get a notice) | 1 GB | Worse wake story |
| Supabase Free | Plan is free, but project **pauses after 7 days idle** (manual resume; deleted if paused ~1 year) | Always-on until pause | 500 MB | Bad if you skip a week |
| Render Free | **Yes — 30 days**, then 14-day grace and delete | Restarts anytime | 1 GB | Rejected |

Neon setup:

1. Sign up at [console.neon.tech](https://console.neon.tech) (no credit card).
2. New project → name `linkedin-daily-poster` → region close to you (or to wherever the Nest app will run).
3. Dashboard → **Connect** → copy both URLs (enable Prisma if shown):
   - **Pooled** (`…-pooler.…`) → `DATABASE_URL` (app queries; has connection pooling)
   - **Direct** (no `-pooler`) → `DIRECT_URL` (Prisma migrations)
4. Both need `?sslmode=require`.
5. Prisma datasource: `url = env("DATABASE_URL")`, `directUrl = env("DIRECT_URL")`.

Limits that actually matter: **0.5 GB** storage (plenty for runs/drafts/voice), **100 CU-hours/month** (daily 07:00 job is fine), compute **must** scale to zero on Free. Hitting a monthly cap suspends compute until next month — this personal app will not hit that. First query after sleep is a short cold start; the 07:00 cron should tolerate it (retry once on connection error).

Local Docker Postgres remains optional for offline work.

**Images — [Backblaze B2](https://www.backblaze.com/docs/cloud-storage-call-the-s3-compatible-api)** (~10 GB free)

- Create a **public** bucket (readable URLs for the dashboard; uploads still need the app key). Name e.g. `linkedin-daily-poster`.
- Create an **Application Key** (not the master key — S3 API rejects master). Restrict to this bucket; enable `listAllBucketNames` so the AWS SDK can list/head the bucket.
- S3-compatible client (`@aws-sdk/client-s3`):
  - Endpoint: `https://s3.<region>.backblazeb2.com` (region is on the bucket page, e.g. `us-west-004`)
  - `keyID` → `B2_KEY_ID` / `AWS_ACCESS_KEY_ID`
  - `applicationKey` → `B2_APPLICATION_KEY` / `AWS_SECRET_ACCESS_KEY`
  - Signature v4 only; `forcePathStyle: true` if the SDK mis-signs virtual-host URLs
- After `PutObject`, persist the public S3 URL: `https://<bucket>.s3.<region>.backblazeb2.com/<key>` (e.g. `drafts/{runId}/v{n}.png`).
- Dev: `MEDIA_DRIVER=local` writes `./uploads`. Prod: `MEDIA_DRIVER=b2`.

---

## 12. Voice (product rule)

Voice is a **dataset**, not a slogan. This app copies **your** writing style, not a company brand voice.

- v1 prompt = system rules (from `prompts/voice-profile.md`) + up to N active samples concatenated.
- UI copy: “The model copies writing style from these posts. It is not audio cloning.”
- Guardrails: do not copy sample _topics_; do not invent client names, company metrics, or personal stories.
- Adding **your real posts** is the main quality lever. Target 8–12 curated samples (import many, activate the best).
- Do not scrape linkedin.com for voice. Use the official archive + this app’s publish history.

---

## 13. Implementation plan

### Phase 0 — Repo (2–3 days)

- pnpm monorepo, Nest + Next + Prisma, env example, Docker Compose (local Postgres + Redis).
- Prod data: Neon Free Postgres (`DATABASE_URL` + `DIRECT_URL`); images: Backblaze B2.
- Seed your login, 4 RSS sources, 4 voice samples from `prompts/voice-samples.md`.

### Phase 1 — Pipeline core (1 week)

- News collect + normalize (no LLM).
- Research, rank, content, voice agents as Nest providers with JSON schemas (zod).
- Image gen via Pixazo Flux Schnell; store on local disk in dev, Backblaze B2 in prod.
- `POST /runs` + worker; persist run + draft.
- No LinkedIn yet; status stops at `pending_approval`.

### Phase 2 — Dashboard (1 week, overlaps)

- Login, Today page, editable post, polling while generating.
- Runs history + run detail (winner, three drafts, versions).
- Voice samples CRUD + **Import LinkedIn archive** (`Shares.csv` / zip).
- Approve/Reject/Skip wired to API (approve can no-op publish until Phase 3).

### Phase 3 — LinkedIn + cron (3–4 days)

- OAuth connect in Settings.
- Publish on approve; error handling.
- `@Cron('0 7 * * *', { timeZone: 'Asia/Kolkata' })`.
- Optional Telegram “draft ready” + link to `/`.

### Phase 4 — Harden (ongoing)

- LinkedIn image attach.
- Rate limits, retries, redacted logs.
- Skip duplicate winner vs last 7 published titles.
- After publish: optional “Save as voice sample”.
- If LinkedIn opens `r_member_social`, add “Sync my posts” (not v1).

**Exit criteria for v1:** You can generate, edit, approve, and see the post on **your** LinkedIn profile without opening n8n.

---

## 14. Mapping from n8n

| n8n node                          | NestJS                     | Next.js               |
| --------------------------------- | -------------------------- | --------------------- |
| Cron 7:00                         | `SchedulerService`         | Settings: cron on/off |
| Manual trigger                    | `POST /runs`               | Generate now          |
| RSS × 4 + Merge + Code            | `NewsService`              | Settings → sources    |
| Research / Rank / Content / Voice | `AgentsService`            | Run detail            |
| Voice samples Set node            | `voice_samples` table      | `/voice`              |
| Image Agent                       | `MediaService`             | Image on Today        |
| Telegram approval                 | Notification + `/` actions | Approve / Reject      |
| LinkedIn node                     | `LinkedInService`          | Settings connect      |
| Regenerate loop                   | new `drafts.version`       | Same Today screen     |

---

## 15. Non-functional

- Timezone: Asia/Kolkata.
- One pipeline job at a time (Redis lock `pipeline:lock`).
- LLM timeout 120s per step; run fails with `error_message` if a step dies.
- Secrets in env: `GROQ_API_KEY`, `PIXAZO_API_KEY`, `LINKEDIN_CLIENT_ID/SECRET`, `DATABASE_URL` + `DIRECT_URL` (Neon), `B2_*` keys, `REDIS_URL`, `ENCRYPTION_KEY` for tokens.
- Do not log access tokens or full API keys.
- LinkedIn: respect ToS; this app posts **only** to your own personal profile after you tap Approve.

---

## 16. Success metrics (v1)

- Time from 07:00 to draft-ready &lt; 8 minutes on typical days.
- Approve-from-dashboard without leaving the Today page.
- ≥ 1 successful LinkedIn publish to your personal profile.
- Voice: you rate “sounds like me” ≥ 4/5 on 5 consecutive drafts (qualitative).
- Zero publishes without an Approve action in the audit log.

---

## 17. Risks

| Risk                               | Mitigation                                                             |
| ---------------------------------- | ---------------------------------------------------------------------- |
| LinkedIn OAuth / API version churn | HTTP + `LinkedIn-Version` header; isolate in one module                |
| Model drifts off-voice             | More samples; keep temperature ~0.55; human edit always available      |
| RSS feeds break                    | Per-source try/catch; run continues with remaining feeds               |
| Double publish                     | Idempotent approve; status check before LinkedIn POST                  |
| Cost / free-tier churn             | Pin Groq + Pixazo free models; env fallbacks; cap one generate/day unless manual; log token usage |
| LinkedIn automation policy         | Human confirmation required; no scraping LinkedIn; no unsolicited spam |
| Neon compute asleep (5 min idle)   | First 07:00 query auto-wakes (~1s); retry once on connection error     |
| Cannot read old posts via OAuth    | `r_member_social` is closed; import official `Shares.csv`; save posts this app publishes |

---

## 18. Open questions

1. Telegram wait-for-button in v1, or in-app only + Telegram ping?
2. Publish image with the post in v1, or text-first?
3. Should Reject always keep the same winner story, or allow “pick runner-up”?
4. App host: Render web service vs a small VPS? (DB is Neon either way)

**Resolved:** Voice from previous LinkedIn posts — yes, via official data archive import + saving posts this app publishes. Not via scraping. Not via `r_member_social` until LinkedIn opens it.

**Resolved:** Images on **Backblaze B2**. Database is **Neon Free Postgres** (permanent; does not expire). Not Render Free Postgres.

**Recommended defaults:** in-app approval + Telegram ping; text-first publish; same story on reject; Neon + B2; app on Render or a small VPS.

---

## 19. Appendix — prompt sources to port

- Research / ranking / content / regenerate system prompts: `workflows/linkedin-daily-knowledge-post.json`
- Voice rules: `prompts/voice-profile.md`
- Few-shot samples: `prompts/voice-samples.md`

These become TypeScript prompt templates under `apps/api/src/pipeline/prompts/`, with samples loaded from the database at runtime.
