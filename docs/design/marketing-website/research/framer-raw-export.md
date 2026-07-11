# Framer raw export research

**Date:** 2026-06-27
**Goal:** Determine whether agenta.ai blog content can be pulled from the Framer account in raw form (bodies + true publish dates + correct authors), and what auth/credentials Mahmoud needs to provide for each viable path.

---

## Summary verdict

Yes — there are two viable raw-export paths, one fully automated and one manual. Both require the Framer account owner (Mahmoud) to take a small action. Neither requires session cookies or account credentials to be shared with us; both use tokens or exported files.

**Recommended path: Framer Server API (automated, repeatable)**

Framer launched the Server API in February 2026 (currently free open beta). It exposes the same CMS read methods as the Plugin API — `getCollections()`, `getFields()`, `getItems()` — from a Node.js script running outside the editor, authenticated via a project-scoped API key. This gives us every CMS field, including `formattedText` (the rich-text body), `date`, author `collectionReference` fields, and image URLs, in structured JSON with zero scraping.

**Fallback path: JSON export via plugin (one-time manual)**

If Mahmoud does not want to generate an API key, he can open the Framer project, install the "JSON Import & Export" plugin (free, open source), export each collection to a `.json` file, and send us the files. This is a manual click-through action inside the editor and takes about 5 minutes per collection.

---

## Path 1 — Framer Server API (best option)

### What it is

The [Framer Server API](https://www.framer.com/developers/server-api-introduction) was released in February 2026. It connects via a stateful WebSocket to the Framer project (no browser open required) using the `framer-api` npm package. It shares all Plugin API methods, including the full CMS read surface:

- `framer.getCollections()` — lists all collections in the project (Posts, Authors, Categories, etc.)
- `collection.getFields()` — returns field schema (id, name, type)
- `collection.getItems()` — returns all items with `id`, `slug`, and `fieldData` keyed by field id

Field types exposed include:
- `string` — title, excerpt, slug
- `formattedText` — rich text body, returned as HTML
- `date` — UTC date string (the true CMS-stored publish date, not the scraped page date)
- `collectionReference` / `multiCollectionReference` — author links by slug
- `image` — image asset URL
- `boolean`, `number`, `enum`, `link`, etc.

### What to ask Mahmoud to provide

1. Go to the agenta.ai Framer project.
2. Open **Site Settings** (gear icon, top right in editor).
3. Go to the **General** tab.
4. Find **Server API** and click **Generate API Key**.
5. Copy the key and send it securely (e.g. a password manager share, or a temporary 1password link).
6. Also share the **project URL** (the `framer.com/projects/<id>` URL visible in the editor address bar or the key generation dialog).

That is all. The key is project-scoped and read+write (the API does not offer read-only keys currently), so Mahmoud should treat it as a secret. We would use it in a short Node.js script that reads and then discards the connection; we never need his Framer login credentials.

### What we get

A JSON payload for each collection item containing every CMS field. For the blog:
- Full HTML body (`formattedText` field)
- True UTC publish date stored in Framer's `date` field (not the rendered page date)
- Author references by slug, which we resolve against the Authors collection in the same call
- Cover image asset URLs
- All metadata fields (category, tags, slug, SEO title/description, etc.)

### Limitations

- The Server API is in **open beta** as of the research date. Framer has not announced deprecation or billing for it yet.
- The API key is read+write; there is no read-only scope. Mahmoud should revoke it once the export is done if he prefers not to leave it active.
- `formattedText` is returned as HTML, not Markdown. If Markdown is needed downstream, it requires an HTML-to-Markdown pass.

### Code sketch (what we would run)

```js
// npm i framer-api
import { connect } from "framer-api"

const framer = await connect(
  process.env.FRAMER_PROJECT_URL,
  process.env.FRAMER_API_KEY
)

const collections = await framer.getCollections()
const result = {}

for (const col of collections) {
  const fields = await col.getFields()
  const items  = await col.getItems()
  result[col.name] = { fields, items }
}

await framer.disconnect()
console.log(JSON.stringify(result, null, 2))
```

---

## Path 2 — JSON plugin export (manual fallback)

### What it is

The [JSON Import & Export plugin](https://www.framer.com/marketplace/plugins/json-sync/) (free, open source, published June 2026 on Framer Marketplace) exports any collection as a `.json` file from inside the Framer editor. It covers all field types and shows a preview before download.

The official [CMS Export plugin by Framer](https://www.framer.com/marketplace/plugins/cms-export/) does the same for CSV. CSV is simpler to open but truncates `formattedText` bodies in most spreadsheet apps; JSON is the better format for raw body content.

### What to ask Mahmoud to do

1. Open the agenta.ai Framer project in the editor.
2. Go to **Plugins** (puzzle icon in toolbar) → search "JSON Import & Export" → install.
3. In the plugin panel, select the **Posts** collection → preview → download `posts.json`.
4. Repeat for the **Authors** collection → download `authors.json`.
5. (Optionally) repeat for any Categories or Tags collections.
6. Send us the `.json` files (email, Slack, Google Drive, etc.).

No credentials, no API key, no technical setup. This is about 5 minutes of editor clicks.

### What we get

Same field coverage as Path 1 (the plugin uses the same Plugin API internally). Bodies come as HTML. Dates come as the CMS-stored UTC value. Author references are collection-reference slugs resolved against the Authors export.

### Limitations

- One-time snapshot: the export is a manual process and must be repeated if posts are added or updated.
- Not automatable without additional tooling.

---

## Path 3 — Framer MCP servers (investigated, not recommended)

Several community-built MCP servers exist for Framer:

- **ericpjtsai/framer-mcp-server** (`npm install -g framer-mcp-server`): provides tools including CMS collection read. Auth method is unclear from public docs; likely requires a Framer session or project token.
- **tmcpro/framer-mcp**: MCP with a plugin companion; communicates via a Framer plugin running in the editor (not fully headless).
- **Framer Marketplace "MCP" plugin**: connects the editor to Claude/Cursor via a tunnel; requires the editor to be open.

None of these are officially supported by Framer, and none have stable documentation for CMS read auth. The Server API (Path 1) supersedes them for this use case. Skip the MCP path.

---

## Path 4 — Framer Plugin API in-editor (context only)

The Plugin API (what plugins run on) is a sandboxed JS environment inside the Framer editor. It can call `getCollections()` / `getItems()` exactly like the Server API, but it requires a plugin to be installed and the editor to be open. The Server API is the headless version of the same surface. No additional investigation needed; Path 1 covers this.

---

## Field type coverage for the blog use case

| Need | Framer field type | Available via Server API / plugin export |
|---|---|---|
| Post body (rich text) | `formattedText` | Yes — returned as HTML |
| Publish date | `date` | Yes — UTC string, the true CMS date |
| Author (single) | `collectionReference` | Yes — slug reference, resolve from Authors collection |
| Author (multiple) | `multiCollectionReference` | Yes — array of slugs |
| Cover image | `image` | Yes — asset URL |
| Slug | `slug` (item built-in) | Yes — top-level field on every item |
| Title / excerpt | `string` | Yes |
| Categories / tags | `collectionReference` | Yes |

---

## What the owner does NOT need to provide

- Framer login credentials (email + password)
- Session cookies or browser export
- Read-only collaborator access (not needed for either path)
- Daytona or any sandbox resource

---

## Sources

- [Framer Server API — introduction](https://www.framer.com/developers/server-api-introduction)
- [Framer Server API — quick start](https://www.framer.com/developers/server-api-quick-start)
- [Framer Server API — reference](https://www.framer.com/developers/server-api-reference)
- [Framer Server API — updates announcement](https://www.framer.com/updates/server-api)
- [Framer Plugin API — CMS guide](https://www.framer.com/developers/cms)
- [Framer Plugin API — reference (getCollections, getItems, etc.)](https://www.framer.com/developers/reference)
- [CMS Export plugin by Framer (CSV)](https://www.framer.com/marketplace/plugins/cms-export/)
- [JSON Import & Export plugin by Isaac Roberts](https://www.framer.com/marketplace/plugins/json-sync/)
- [GitHub — framer-json-sync (open source)](https://github.com/madebyisaacr/framer-json-sync)
- [GitHub — framer/server-api-examples](https://github.com/framer/server-api-examples)
- [Framer help — porting your data](https://www.framer.com/help/articles/porting-your-data-from-framer/)
