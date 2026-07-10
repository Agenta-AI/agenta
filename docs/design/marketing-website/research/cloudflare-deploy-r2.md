# Cloudflare Deploy + R2: Headless Capabilities and Auth Requirements

Researched 2026-06-27. Covers wrangler CLI capabilities, API token scopes, official
Cloudflare MCP servers, Workers Builds vs wrangler, and R2 font-injection credentials.

---

## 1. Wrangler CLI: Headless Capabilities

Wrangler v3 supports fully non-interactive operation with two environment variables:

```
CLOUDFLARE_API_TOKEN=<token>
CLOUDFLARE_ACCOUNT_ID=<account-id>
```

The `CF_*` variants are deprecated. These two variables are the modern canonical names
confirmed in the wrangler v3 system environment variables docs.

### (a) Create an R2 bucket

```bash
npx wrangler r2 bucket create agenta-website-fonts
# optional: pin to a region
npx wrangler r2 bucket create agenta-website-fonts --location eeur
```

### (b) Upload objects to R2

```bash
npx wrangler r2 object put agenta-website-fonts/GT-Alpina-Standard-Light.woff2 \
  --file ./fonts/GT-Alpina-Standard-Light.woff2 \
  --content-type font/woff2 \
  --cache-control "public, max-age=31536000, immutable"
```

Key flags for `r2 object put`:
- `[BUCKET/KEY]` — destination path (positional, required)
- `--file` / `-f` — local file to upload
- `--pipe` / `-p` — read from stdin instead
- `--content-type` / `-ct` — MIME type
- `--cache-control` / `-cc` — cache headers
- `--content-disposition` / `-cd`
- `--storage-class` / `-s`

Wrangler authenticates directly to Cloudflare using `CLOUDFLARE_API_TOKEN`; no
separate S3 credentials are required for `wrangler r2 object put`.

### (c) Deploy a Workers Static Assets site

```bash
npx wrangler deploy
```

Wrangler reads `wrangler.jsonc` from the current directory. Our existing
`wrangler.jsonc` already has the correct `assets.directory = "./dist"` config. The
deploy command uploads the `dist/` tree as static assets and creates/updates the
Worker named `agenta-website`.

To run from the monorepo root (CI):

```bash
cd website && pnpm build && npx wrangler deploy
```

### (d) Set a custom domain

Add to `wrangler.jsonc`:

```jsonc
{
  "routes": [
    { "pattern": "agenta.ai", "custom_domain": true }
  ]
}
```

Then run `npx wrangler deploy`. Cloudflare automatically creates the DNS record and
provisions a TLS certificate. **Prerequisite:** the domain `agenta.ai` must already
be on Cloudflare (pointing to Cloudflare nameservers) under the same account.
Mahmoud must confirm this; once it is, the wrangler config + deploy does everything
else.

You can also manage routes without custom_domain (path-based routing on a zone):

```jsonc
{
  "routes": [
    { "pattern": "agenta.ai/*", "zone_name": "agenta.ai" }
  ]
}
```

That variant requires the zone's Workers Routes permission.

---

## 2. API Token Scopes (Least Privilege)

### Token to request from Mahmoud

Create one API token in the Cloudflare dashboard
(dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom Token):

| Permission row | Resource | Level |
|---|---|---|
| Account Settings | Account: agenta.ai | Read |
| Workers Scripts | Account: agenta.ai | Edit |
| Workers R2 Storage | Account: agenta.ai | Edit |
| Workers Routes | All zones (or zone: agenta.ai) | Edit |

**Account Settings: Read** is required by wrangler for account introspection (verifying
account ID, subdomain).

**Workers Scripts: Edit** covers `wrangler deploy` (uploading the Worker + assets).

**Workers R2 Storage: Edit** covers `wrangler r2 bucket create` and
`wrangler r2 object put`.

**Workers Routes: Edit** (zone-level) covers adding routes and custom domains via
`wrangler deploy` when `routes` are in `wrangler.jsonc`.

Workers Builds CI tokens: Cloudflare auto-generates its own build token internally
when Workers Builds is set up — that is separate from this token.

### What Mahmoud also needs to supply separately

- **Account ID** — visible at dash.cloudflare.com → right sidebar of any Workers/R2
  page. A 32-char hex string. Set as `CLOUDFLARE_ACCOUNT_ID`.

### What is NOT needed in this token

- Zone: Read (not needed for custom_domain deployments; wrangler resolves it from
  the account)
- DNS: Edit (wrangler handles DNS automatically when custom_domain = true)
- Workers KV Storage (we use R2, not KV)
- Workers Builds (that is dashboard-only setup)

---

## 3. Cloudflare Official MCP Servers

Cloudflare publishes a growing set of **remotely hosted** MCP servers at
`https://github.com/cloudflare/mcp-server-cloudflare` and
`https://github.com/cloudflare/mcp`. All use **OAuth by default**, with API token
as the automation fallback.

### Full list (as of 2026-06-27)

| MCP server | URL | Purpose |
|---|---|---|
| **Cloudflare API** | https://mcp.cloudflare.com/mcp | Entire Cloudflare API (2500+ endpoints incl. Workers, R2, DNS) |
| **Documentation** | https://docs.mcp.cloudflare.com/mcp | Reference docs Q&A |
| **Workers Bindings** | https://bindings.mcp.cloudflare.com/mcp | Create/manage Workers storage bindings (R2, KV, D1) |
| **Workers Builds** | https://builds.mcp.cloudflare.com/mcp | Manage and inspect Workers Builds CI jobs |
| **Observability** | https://observability.mcp.cloudflare.com/mcp | Query Worker logs and analytics |
| **Radar** | https://radar.mcp.cloudflare.com/mcp | Internet traffic insights |
| **Container** | https://containers.mcp.cloudflare.com/mcp | Sandbox dev environments |
| **Browser Run** | https://browser.mcp.cloudflare.com/mcp | Headless browser / scraping |
| **Logpush** | https://logs.mcp.cloudflare.com/mcp | Logpush job health |
| **AI Gateway** | https://ai-gateway.mcp.cloudflare.com/mcp | AI request logs |
| **AI Search (AutoRAG)** | https://autorag.mcp.cloudflare.com/mcp | Document search |
| **Audit Logs** | https://auditlogs.mcp.cloudflare.com/mcp | Account audit log queries |
| **DNS Analytics** | https://dns-analytics.mcp.cloudflare.com/mcp | DNS performance |
| **DEM** | https://dex.mcp.cloudflare.com/mcp | Digital Experience Monitoring |
| **CASB** | https://casb.mcp.cloudflare.com/mcp | SaaS security misconfigurations |
| **GraphQL** | https://graphql.mcp.cloudflare.com/mcp | Cloudflare analytics GraphQL |
| **Agents SDK Docs** | https://agents.cloudflare.com/mcp | Agents SDK documentation |

### R2 + deploy relevance

- The **Cloudflare API MCP** (`mcp.cloudflare.com/mcp`) covers the entire REST API
  including R2 bucket creation, R2 object upload, and Workers deploy. It works through
  `search()` + `execute()` tool calls. This is the most capable option for
  R2/deploy tasks via MCP.
- **Workers Bindings MCP** specifically manages R2, KV, D1 bindings for Workers.
- **Workers Builds MCP** can trigger and inspect build jobs but not wire up the
  initial GitHub integration (that requires OAuth through the dashboard).

### Should we use MCP instead of wrangler?

**No, not for this project.** Reasons:

1. Wrangler is the canonical deploy tool; its `wrangler.jsonc` config IS the
   deployment contract. MCP is a natural-language layer on top of the same API.
2. The MCP servers all use OAuth as the primary auth method. Wiring OAuth into a CI
   flow (GitHub Actions) is more complex than a static API token.
3. Wrangler gives deterministic, reproducible deploys via the checked-in config.
   MCP tool calls are higher-variance.
4. The **Workers Observability MCP** is genuinely useful post-deploy for debugging
   (log queries), but that is a separate concern from deploying.

---

## 4. Workers Builds (git CI) vs wrangler deploy

### Workers Builds — what it is

Cloudflare's native CI/CD system. When connected to GitHub, it auto-deploys on every
push and provides per-PR preview deployments. This is what our `wrangler.jsonc` was
written for (the comment "deploy happens later via Cloudflare Workers Builds").

### What only Mahmoud can set up (dashboard clicks)

Workers Builds cannot be activated headlessly. The setup requires:

1. Install the **Cloudflare Workers & Pages GitHub App** on the `agenta` GitHub
   organization via browser OAuth flow (`dash.cloudflare.com → Workers & Pages → Connect to Git`).
2. In the dashboard: select the `agenta` repo, set **Root Directory** to `website/`,
   set **Build Command** to `pnpm install && pnpm build`, set **Deploy Command** to
   `npx wrangler deploy` (or leave at default), set **Watch Paths** to `website/**`
   so only changes in `website/` trigger builds.
3. Add the `R2_FONT_TOKEN` secret (the R2 S3 access key for the prebuild font pull)
   as an environment variable in the Workers Builds settings.

There is no API or CLI path to do step 1 (GitHub App OAuth). Steps 2-3 could
theoretically be done via the Cloudflare REST API, but step 1 gates them.

### What I (the agent) can do now with just the API token

- `wrangler deploy` — manually deploy at any time from CLI or CI.
- `wrangler r2 bucket create` — create the fonts bucket.
- `wrangler r2 object put` — upload font files.
- Add/update custom domain config by editing `wrangler.jsonc` + `wrangler deploy`.
- Set up a GitHub Actions workflow (`.github/workflows/deploy-website.yml`) that runs
  `pnpm build && npx wrangler deploy` on push, using the token as a repo secret.
  This replicates the Workers Builds behaviour without the Cloudflare GitHub App.

### Realistic path forward

**Now (no dashboard):** I can write a GitHub Actions workflow that:
- triggers on push to `main` (paths: `website/**`)
- runs `pnpm install && pnpm build` inside `website/`
- runs the prebuild font-pull step (see section 5)
- runs `npx wrangler deploy`
- uses `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as repo secrets

**Later (with Mahmoud's one dashboard session):** Connect the Cloudflare GitHub App
for native Workers Builds. This gives PR preview URLs (a `*.workers.dev` preview per
PR) and the Cloudflare dashboard build history. The GitHub Actions approach does not
give PR previews. Workers Builds is worth wiring eventually; it is not blocking the
first deploy.

---

## 5. R2 for Fonts: Two Credential Types Explained

### Two distinct credential types

**Type A — Cloudflare API token (`CLOUDFLARE_API_TOKEN`)**
- Used by wrangler CLI for everything.
- `wrangler r2 object put` works with this token.
- Cannot be used for raw S3-compatible HTTP requests (AWS SDK, boto3, rclone, curl
  with `AWS4-HMAC-SHA256` auth).

**Type B — R2 S3 Access Keys (Access Key ID + Secret Access Key)**
- Generated in the R2 dashboard: dash.cloudflare.com → R2 → Manage R2 API tokens
  → Create API token (R2-specific page, not the main API tokens page).
- Access Key ID = the token's `id`.
- Secret Access Key = SHA-256 hash of the token value.
- Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- Used by: AWS CLI, boto3, rclone, any S3-compatible client, and curl with SigV4.

### For the font prebuild step

The prebuild step that downloads fonts from R2 before `astro build` needs to
authenticate against a **private** R2 bucket. Options:

**Option A (simpler): Use wrangler in the prebuild step**

```bash
# In prebuild.sh, run before astro build:
npx wrangler r2 object get agenta-website-fonts/GT-Alpina-Standard-Light.woff2 \
  --file public/fonts/GT-Alpina-Standard-Light.woff2
```

This uses `CLOUDFLARE_API_TOKEN` — the same token as deploy. No extra credentials
needed. Downside: requires Node.js + wrangler installed in the build environment
(it is, since we use wrangler for deploy).

**Option B: S3-compatible client (AWS CLI or rclone)**

```bash
aws s3 cp s3://agenta-website-fonts/GT-Alpina-Standard-Light.woff2 \
  public/fonts/GT-Alpina-Standard-Light.woff2 \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

Requires separate `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` secrets from the R2
dashboard, in addition to the main API token.

**Option C: Presigned URL**

Generate a time-limited presigned URL offline and embed it in CI. The URL is
self-authenticating; `curl -O <presigned-url>` just works. Presigned URLs are
generated via the R2 Temporary Credentials API or locally by JWT signing with the
S3 access key. Useful for very restricted environments but adds key-management
complexity.

**Recommendation: Option A** (wrangler). It reuses the same `CLOUDFLARE_API_TOKEN`
already needed for deploy, requires no extra credentials, and wrangler is already
in the build environment.

### R2 bucket access policy note

For the font bucket, keep it **private** (no public access). The wrangler-based
prebuild pull authenticates via the API token. The built fonts end up in `dist/`
and are served directly by the Worker from the static assets binding — no R2
public URL exposure needed.

---

## Summary: What to Ask Mahmoud For

### Credentials Mahmoud must create

**Item 1: One Cloudflare API token**

In the Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom Token:

| Row | Resource | Level |
|---|---|---|
| Account Settings | Account (agenta's account) | Read |
| Workers Scripts | Account (agenta's account) | Edit |
| Workers R2 Storage | Account (agenta's account) | Edit |
| Workers Routes | Zone (agenta.ai) | Edit |

Set expiry as appropriate (1 year is reasonable for a deploy token; rotate after).

**Item 2: Cloudflare Account ID** (visible in the right sidebar of dash.cloudflare.com)

These two items go into:
- GitHub repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- (locally) `.env` or shell profile for my dev sessions

### Dashboard steps only Mahmoud can do

**Required for native Workers Builds (PR previews):**
- Install the Cloudflare Workers & Pages GitHub App on the `agenta` org via browser
  OAuth (`dash.cloudflare.com → Workers & Pages → Connect to Git`).
- In the Worker settings: set Root Directory = `website/`, Watch Paths = `website/**`.
- Add build environment variable: `CLOUDFLARE_API_TOKEN` (or Cloudflare generates its
  own internal build token; check the Builds UI).

**Not blocking the first deploy.** I can deploy via GitHub Actions or direct
`wrangler deploy` with just the API token + account ID before Workers Builds is wired.

### What I can do headlessly with just the token + account ID

| Task | How |
|---|---|
| Create the R2 fonts bucket | `wrangler r2 bucket create agenta-website-fonts` |
| Upload font files to R2 | `wrangler r2 object put agenta-website-fonts/<key> --file ...` |
| Build the site | `pnpm build` inside `website/` |
| Pull fonts in prebuild | `wrangler r2 object get agenta-website-fonts/<key> --file ...` |
| Deploy to `agenta-website.workers.dev` | `wrangler deploy` |
| Add custom domain `agenta.ai` | Edit `wrangler.jsonc` routes + `wrangler deploy` |
| Write GitHub Actions CI/CD workflow | `.github/workflows/deploy-website.yml` |

### What still needs Mahmoud's dashboard click

| Task | Why |
|---|---|
| Workers Builds GitHub App install | Requires browser OAuth to authorize Cloudflare on GitHub |
| PR preview deployments | Only available through Workers Builds (not wrangler CLI) |
| Setting Workers Builds env secrets | Dashboard only (or via Cloudflare REST API once GitHub App is installed) |

---

## Cloudflare MCP Verdict

The **Cloudflare API MCP** (`mcp.cloudflare.com/mcp`) can do everything wrangler can,
including R2 and Workers deploy, via natural language. **But wrangler is the better
tool for this project** because:
- It reads our checked-in `wrangler.jsonc` and is deterministic.
- The MCP server uses OAuth as primary auth, which is more complex to wire in CI than
  a static API token.
- The **Workers Observability MCP** is worth connecting for post-deploy log debugging.

If Mahmoud wants to add the Cloudflare API MCP to this session for ad-hoc management
tasks (inspect buckets, check deploy status, query logs), the config is:
```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.cloudflare.com/mcp"],
      "env": { "CLOUDFLARE_API_TOKEN": "<token>" }
    }
  }
}
```
This requires adding `mcp-remote` and doing an OAuth login once, or passing the API
token directly if the server supports it.

---

## References

- [Wrangler commands: R2](https://developers.cloudflare.com/workers/wrangler/commands/r2/)
- [Wrangler system environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)
- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [R2 authentication & token types](https://developers.cloudflare.com/r2/api/tokens/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Workers CI/CD: Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Builds: GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
- [Workers Builds: Advanced setups (monorepo)](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [Custom domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare MCP servers docs](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/)
- [github.com/cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare)
