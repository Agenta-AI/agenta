# Deploy runbook — agenta.ai marketing website

Ordered steps to go from the current state (built locally, no Cloudflare credentials)
to a live `agenta.ai` deployment. Prerequisites are marked **[MAHMOUD]** where they
require browser OAuth or dashboard access only Mahmoud can do.

---

## Step 1 — Create the Cloudflare API token [MAHMOUD]

In the Cloudflare dashboard:
**dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom Token**

Add these permission rows:

| Permission row | Resource | Level |
|---|---|---|
| Account Settings | Account: agenta's account | Read |
| Workers Scripts | Account: agenta's account | Edit |
| Workers R2 Storage | Account: agenta's account | Edit |
| Workers Routes | Zone: agenta.ai | Edit |

Set an expiry (1 year is reasonable; rotate after). Copy the token value — it is
shown only once.

Also note the **Account ID** (visible in the right sidebar of any Workers or R2
page in the dashboard). It is a 32-character hex string.

---

## Step 2 — Create the R2 fonts bucket

With the token in your shell:

```bash
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ACCOUNT_ID=<account-id>

cd website
npx wrangler r2 bucket create agenta-website-fonts
```

Optional: pin the bucket to a specific region (EU-east for GDPR proximity):

```bash
npx wrangler r2 bucket create agenta-website-fonts --location eeur
```

Verify:

```bash
npx wrangler r2 bucket list
```

---

## Step 3 — Upload the licensed font files to R2

The six licensed woff2 files must be uploaded to the bucket before the first build.
Run from the `website/` directory (or adjust `--file` paths accordingly).

```bash
for font in \
  GT-Alpina-Light.woff2 \
  GT-Alpina-Light-Italic.woff2 \
  GT-Alpina-Regular.woff2 \
  GT-Alpina-Regular-Italic.woff2 \
  GT-Alpina-Medium.woff2 \
  PPMondwest-Regular.woff2
do
  npx wrangler r2 object put "agenta-website-fonts/${font}" \
    --file "public/fonts/${font}" \
    --content-type "font/woff2" \
    --cache-control "public, max-age=31536000, immutable"
done
```

These files are gitignored (`public/fonts/GT-Alpina-*`, `public/fonts/PPMondwest-*`).
They must be present locally (or in CI) when you run this upload step.

Verify the upload:

```bash
npx wrangler r2 object list agenta-website-fonts
```

---

## Step 4 — Set GitHub / CI secrets

In the GitHub repository:
**Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | The token from Step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID from Step 1 |
| `PUBLIC_POSTHOG_KEY` | The PostHog project API key for agenta.ai |

Optional:

| Secret name | Value |
|---|---|
| `PUBLIC_GA_ID` | GA4 measurement id (`G-XXXXXXXXXX`) — leave blank to keep GA off |

---

## Step 5 — Enable the GitHub Actions workflow

Copy the draft workflow into the active workflows directory:

```bash
cp docs/design/marketing-website/deploy/deploy-website.yml \
   .github/workflows/deploy-website.yml
```

Commit and push. The workflow triggers on the next push to `main` that touches
`website/**`. To trigger it manually: **Actions → Deploy marketing website →
Run workflow**.

---

## Step 6 — First deploy (manual)

To deploy immediately without waiting for a push:

```bash
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ACCOUNT_ID=<account-id>
export PUBLIC_POSTHOG_KEY=<key>

cd website
pnpm install
pnpm build    # prebuild (fetch-fonts.mjs) runs automatically before astro build
npx wrangler deploy
```

After deploy, the site is live at:
`https://agenta-website.<your-workers-subdomain>.workers.dev`

Cloudflare prints the deployment URL in the wrangler output.

---

## Step 7 — Add the custom domain [MAHMOUD prerequisite: agenta.ai on Cloudflare]

**Prerequisite:** `agenta.ai` must be on Cloudflare (pointing to Cloudflare
nameservers) under the same account as the API token. Once it is:

1. Uncomment the `routes` block in `website/wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "agenta.ai", "custom_domain": true }
]
```

2. Run `npx wrangler deploy` from `website/`. Cloudflare creates the DNS record and
   provisions a TLS certificate automatically. No further DNS edits are needed.

Verify: `curl -I https://agenta.ai/` should return HTTP 200 with
`CF-Worker: agenta-website`.

---

## Step 8 — Wire the author trailing-slash Transform Rule [MAHMOUD]

The live site canonical for author profile pages is `/authors/<slug>/` (with
trailing slash), but `html_handling: "drop-trailing-slash"` in `wrangler.jsonc`
canonicalizes all paths to no-slash. A `_redirects` rule cannot fix this without
a loop (see `public/_redirects` comment block).

Fix via a Cloudflare Zone-level Transform Rule:

**Cloudflare dashboard → agenta.ai zone → Rules → Transform Rules → Create rule**

- **Rule name:** `Author profile trailing slash`
- **Match (Custom expression):**
  ```
  (http.request.uri.path matches "^/authors/[^/]+$")
  ```
- **Action:** Rewrite URL (dynamic)
  - **Path:** `concat(http.request.uri.path, "/")`

This rewrites `/authors/foo` → `/authors/foo/` before the Worker asset handler
sees the request. The browser receives the slash URL as canonical, matching the
live site.

**Alternative (simpler):** Change `html_handling` in `wrangler.jsonc` from
`"drop-trailing-slash"` to `"auto-trailing-slash"`. Cloudflare will then preserve
existing trailing slashes and serve both slash and no-slash URLs without redirecting.
Test on a staging deploy before switching in production — the behaviour on non-author
pages may differ.

---

## Step 9 (optional) — Workers Builds for PR preview URLs [MAHMOUD]

This step gives per-PR preview deployments (each PR gets a `*.workers.dev` URL).
It requires browser OAuth and cannot be done headlessly.

1. **Install the Cloudflare Workers & Pages GitHub App** on the `agenta` GitHub
   organization:
   **dash.cloudflare.com → Workers & Pages → Connect to Git → GitHub → Authorize**

2. In the Workers Builds settings for `agenta-website`:
   - **Root Directory:** `website/`
   - **Build Command:** `pnpm install && pnpm build`
   - **Watch Paths:** `website/**` (so only changes in `website/` trigger builds)

3. Add build environment variables (in the Builds UI, not as GitHub secrets):
   - `CLOUDFLARE_API_TOKEN` (or Cloudflare generates its own internal build token)
   - `PUBLIC_POSTHOG_KEY`

Once wired, every PR that touches `website/**` gets a preview URL automatically.
The GitHub Actions workflow (Step 5) can then be disabled or kept as a fallback.

---

## Summary: what's needed before the first public deploy

| Item | Who | Status |
|---|---|---|
| Cloudflare API token (4 scopes) | Mahmoud | Pending |
| Cloudflare Account ID | Mahmoud | Pending |
| R2 bucket created | Agent (with token) | Pending |
| Licensed fonts uploaded to R2 | Agent (with token + local fonts) | Pending |
| GitHub secrets set | Mahmoud | Pending |
| GH Actions workflow copied to .github/ | Agent | Pending |
| Custom domain on Cloudflare | Mahmoud | Pending |
| Author trailing-slash Transform Rule | Mahmoud (dashboard) | Pending |
| Workers Builds GitHub App install | Mahmoud (dashboard OAuth) | Optional |

**One-liner "what's needed to actually deploy":**
Mahmoud creates the Cloudflare API token (4 scopes) + supplies the Account ID → everything else can run headlessly.
