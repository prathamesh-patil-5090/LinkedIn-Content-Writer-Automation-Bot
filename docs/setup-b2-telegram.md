# Backblaze B2 + Telegram setup

Do these in the browser / Telegram app. Paste values into the **repo root** `.env`. Never commit that file.

## Backblaze B2 (images)

1. Sign in: [secure.backblaze.com/user_signin.htm](https://secure.backblaze.com/user_signin.htm)
2. Enable **B2 Cloud Storage** if prompted.
3. **Buckets → Create a Bucket**
   - Name: unique, e.g. `ldp-yourname`
   - Files in Bucket are: **Public** (so the dashboard can show images)
4. On the bucket row, copy **Endpoint**, e.g. `s3.us-west-004.backblazeb2.com`
   - Region is the middle bit: `us-west-004`
5. **Application Keys → Add a New Application Key**
   - Name: `linkedin-daily-poster`
   - Allow access to Bucket(s): **that bucket**
   - **Allow List All Bucket Names**: on
   - Type: **Read and Write**
6. Copy `keyID` and `applicationKey` (secret is shown **once**).

`.env`:

```env
MEDIA_DRIVER=b2
B2_BUCKET=ldp-yourname
B2_REGION=us-west-004
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_KEY_ID=...
B2_APPLICATION_KEY=...
B2_PUBLIC_BASE_URL=https://ldp-yourname.s3.us-west-004.backblazeb2.com
```

Use **your** endpoint/region from the dashboard, not these examples.

## Telegram (draft ping)

1. Open Telegram → search **@BotFather** (blue check).
2. Send `/newbot`
3. Display name: `LinkedIn Daily Poster`
4. Username: must end in `bot`, e.g. `yourname_ldp_bot`
5. Copy the **token** (`123456789:AA...`)
6. Open **your new bot** → **Start** → send `hi`
7. In a browser (replace TOKEN):

```
https://api.telegram.org/botTOKEN/getUpdates
```

8. In the JSON, copy `"chat":{"id": 512345678` — that number is `TELEGRAM_CHAT_ID`.

If `result` is `[]`, you have not messaged the bot yet. Send `hi` again and refresh.

`.env`:

```env
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_CHAT_ID=512345678
```

## Verify

With API running (`pnpm dev:api`):

- Health: http://localhost:3001/api/v1/health
- Logged in → **Settings** → **Send test ping** and **Test upload**
