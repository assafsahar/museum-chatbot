# Staging And Production Workflow

## Goal

This document defines a practical workflow for:

- working locally against `staging`
- validating changes safely
- promoting to `production`
- reducing configuration mistakes (env mixups, wrong DB, wrong Netlify context)

It is written for this repository (`museum-chatbot`) and reflects the current setup.

## Current Environment Files

- `.env` -> active local runtime env used by `netlify dev`
- `.env.production` -> local production profile
- `.env.staging` -> local staging profile (writes enabled)
- `.env.staging-readonly` -> local staging profile with `ALLOW_USAGE_WRITE=false`
- `.env.example` -> template only

Important:

- Do not commit `.env*` files with secrets.
- `netlify dev` reads `.env` at runtime.

## Current Netlify Contexts (Expected)

- `production` context -> production Supabase + production behavior
- `branch-deploy` context -> staging Supabase
- `deploy-preview` context -> staging Supabase

This allows:

- `main` deploys to use production
- branch deploys / previews to use staging

## Local Environment Switching

### Switch To Staging (Writes Enabled)

```powershell
Copy-Item .env.staging .env -Force
```

### Switch To Staging (Read Only)

```powershell
Copy-Item .env.staging-readonly .env -Force
```

### Switch To Production (Local Testing)

```powershell
Copy-Item .env.production .env -Force
```

## Start Local Server

Use `cmd` (recommended on this machine) or `npx.cmd` from PowerShell.

```cmd
npx netlify dev --offline --port 8888
```

Why `--offline`:

- prevents accidental remote env overrides from Netlify
- makes local `.env` the source of truth

## Quick Local Health Check

```cmd
curl http://localhost:8888/.netlify/functions/chat
```

Expected fields to verify:

- `appEnv` -> `staging` or `production` (matches `.env`)
- `usageWriteEnabled` -> matches `ALLOW_USAGE_WRITE`
- `hasSupabase` -> `true`
- `hasOpenAiKey` -> `true` (if OpenAI tests are intended)

## Local Smoke Test (Recommended)

### 1) Usage Before

```cmd
curl "http://localhost:8888/.netlify/functions/usage?museumId=adam-hai&exhibitionId=animals&debug=1"
```

### 2) Ask A Question (Unique Text To Avoid Cache)

```cmd
curl -X POST "http://localhost:8888/.netlify/functions/chat?debug=1" ^
  -H "Content-Type: application/json" ^
  -d "{\"museumId\":\"adam-hai\",\"exhibitionId\":\"animals\",\"exhibitId\":\"exhibit-01\",\"question\":\"בדיקת שימוש ייחודית 2026-02-22 12:00\"}"
```

### 3) Usage After

```cmd
curl "http://localhost:8888/.netlify/functions/usage?museumId=adam-hai&exhibitionId=animals&debug=1"
```

Expected:

- `debug.mode` in chat response is usually `openai_ok` (or a safe fallback if OpenAI fails)
- `questionsTotal` increases by 1 (staging with writes enabled)

## UI Validation Checklist (Local Or Staging Deploy)

For a target exhibit page, validate:

- content loads (title, description, image)
- quick buttons appear (all tags from JSON)
- quick button answers return immediately
- open question works (`openai_ok` if key/context is valid)
- usage counter changes (when writes enabled)

Example local URL:

```text
http://localhost:8888/exhibit.html?id=exhibit-01&museum=adam-hai&exhibition=animals
```

## Branch Deploy / Staging Deploy Workflow

### Purpose

Use Netlify branch deploys as cloud staging connected to staging Supabase.

### One-Time Setup (already done)

- Enable Netlify `Branch deploys`
- Set `branch-deploy` and `deploy-preview` env vars to staging DB credentials

### Normal Flow

1. Commit changes on `staging` branch
2. Push `staging`
3. Wait for Netlify branch deploy to finish
4. Open branch deploy URL and validate:
   - `/.netlify/functions/chat`
   - target exhibit page
   - `usage` before/after

## Promotion To Production

### Preconditions

- staging local tests passed
- staging branch deploy tests passed
- no unresolved DB/schema mismatch in staging
- production env vars verified in Netlify

### Promote

Use normal Git flow (merge or push from `staging` to `main`, per your process).

Example (only if intentionally promoting `staging`):

```bash
git push origin staging:main
```

### Production Smoke Test (Immediately After Deploy)

1. Health:

```bash
curl https://museum-chatbot1.netlify.app/.netlify/functions/chat
```

Verify:

- `appEnv: "production"`
- `usageWriteEnabled: true`

2. Usage before/after:

```bash
curl "https://museum-chatbot1.netlify.app/.netlify/functions/usage?museumId=adam-hai&exhibitionId=animals&debug=1"
```

Ask one unique question, then re-check.

## Netlify Environment Management (Project-Specific)

### Production Context

Must stay on production Supabase.

Key checks:

- `ALLOW_USAGE_WRITE=true`
- `APP_ENV=production`
- production `SUPABASE_URL`
- production `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_KEEPALIVE_ENABLED=true` in Netlify UI for `Functions` runtime

### Staging Contexts

Must point to staging Supabase:

- `branch-deploy`
- `deploy-preview`

Recommended values:

- `APP_ENV=staging`
- `ALLOW_USAGE_WRITE=true` (for realistic testing)

## Production Keepalive (Free Tier Workaround)

The project includes a scheduled function:

- `supabase-keepalive`

Purpose:

- keep the production Supabase project active during a free-tier pilot
- run one tiny read query per day

Important:

- the schedule is defined in `netlify.toml`
- the runtime flag must be set in Netlify UI, not only in `netlify.toml`

Required Netlify UI variable:

- `SUPABASE_KEEPALIVE_ENABLED=true`

Recommended scope:

- `Production`
- available to `Functions`

How to verify:

1. Deploy `main`
2. Open Netlify `Functions`
3. Confirm `supabase-keepalive` is marked `Scheduled`
4. Use `Run now`
5. Confirm logs contain `supabase-keepalive ok`

## Troubleshooting

### `invalid_issuer` From OpenAI

Cause (common in this project):

- `netlify dev` using a different `OPENAI_API_KEY` than `.env`

Fix:

1. Run local with `--offline`
2. Verify local `.env` key
3. If needed, sync Netlify `dev` context key too

### `EADDRINUSE ... port 3999`

Netlify dev internal port is occupied.

Fix:

- Kill the stuck `node` process using port `3999`
- Start `netlify dev` again

### Branch Deploy URL Returns `Not Found`

Usually means:

- Branch deploys not enabled
- No branch deploy was created yet
- Wrong URL guessed

Fix:

1. Push branch again
2. Check `Deploys` page for a `Branch deploy` entry
3. Use the exact deploy URL shown there

### Usage Counter Stays Fixed / Wrong

This project currently uses an authoritative fallback from `usage_monthly_exhibit` for exhibition-scoped totals.

If behavior looks wrong:

1. Check `/.netlify/functions/usage?...&debug=1`
2. Confirm `debug.totalSource`
3. Validate writes with a unique question

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` is highly sensitive (server-only)
- If exposed, rotate when practical (for Supabase this may require JWT secret rotation depending on setup)
- After rotation:
  1. update `.env.staging`
  2. update Netlify `branch-deploy` + `deploy-preview`
  3. smoke test staging deploy

## Suggested Routine Before Every Testing Session

1. Switch `.env` to the correct profile
2. Start `netlify dev --offline`
3. Run `chat` health check
4. Run one `usage` before/after smoke test
5. Open target exhibit page and validate UI/UX

## Suggested Routine Before Every Production Promotion

1. Validate locally on `staging`
2. Validate on branch deploy (cloud staging)
3. Verify production Netlify env values
4. Promote to `main`
5. Run production smoke test (health + one chat + usage check)

