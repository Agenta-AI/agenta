# Agenta Documentation

This documentation is powered by [Docusaurus](https://docusaurus.io/), a modern and efficient static site generator.

## Getting Started

To set up the documentation locally, follow these steps:

1. **Install Dependencies**  
   First, install the required packages:

   ```bash
   npm install
   ```

2. **Start the Local Development Server**  
   Spin up the server to start working locally:

   ```bash
   npm run start
   ```

   Open your browser and go to `localhost:5000` to view the development site.

3. **Build the Project**  
   Ensure everything is working by building the project:

   ```bash
   npm run build
   ```

4. **Preview the Production Environment**  
   Run the production build server to see how your site will look in production:
   ```bash
   npm run serve
   ```
   Visit `localhost:3000` to explore the production build.

## Deployment

The docs build to Cloudflare Workers Static Assets. Two workers serve the site:

| Worker | Config | What it serves |
| --- | --- | --- |
| `agenta-docs` | `wrangler.production.jsonc` | the production build, on its own `workers.dev` URL |
| `agenta-docs-preview` | `wrangler.jsonc` | one version per pull request |

**`https://agenta.ai/docs` does not point at these workers yet.** That hostname
still goes through the older `new-docs-router` worker, which proxies to Vercel.
Deploying `agenta-docs` changes no live traffic. The cutover is a separate,
deliberate step: remove the `agenta.ai/docs*` route from `new-docs-router` and
add `agenta.ai/docs` and `agenta.ai/docs/*` to `agenta-docs`. The exact patterns
are commented in `wrangler.production.jsonc`. Rolling back means dropping those
two routes and restoring the old one, which takes about a minute.

Two GitHub Actions workflows drive them:

- `.github/workflows/18-docs-preview.yml` builds every pull request that touches
  `docs/**`, uploads it as a new version of the preview worker under the alias
  `pr-<number>`, and posts the preview URL as a comment on the pull request. Pull
  requests from forks are skipped, because they cannot read the deploy secrets.
- `.github/workflows/19-docs-production.yml` builds and deploys on every merge to
  `main` that touches `docs/**`.

Both run `pnpm run build:worker`, which writes the site into `dist/docs` rather than
`build`. The nested directory makes the file tree match the public `/docs/` URL
prefix, so Cloudflare serves the site with no rewrite rule. `scripts/stage-worker-assets.mjs`
then copies `worker-assets/_headers` and `worker-assets/_redirects` to `dist/`, where
Cloudflare reads them.

To build and serve the exact production artifact locally:

```bash
pnpm run build:worker
npx wrangler dev --config wrangler.jsonc   # http://localhost:8787/docs
```

`scripts/check-parity.mjs` requests every URL in the live sitemap against another
host, which is how a preview or a new production deploy is checked before traffic
moves to it:

```bash
node scripts/check-parity.mjs https://pr-1234-agenta-docs-preview.<subdomain>.workers.dev
```

## Changelog Guidelines

When working on the changelog page, following specific formatting rules are important to ensure the page's layout remains intact. Failure to follow these guidelines may result in broken UI elements.

### Key Guidelines for Editing the Changelog Page

1. **Avoid using italic (`**`) formatting** except when specifying the **publishing date\*\*.
2. **Use Heading 3 (`###`)** for all changelog section titles.
3. **Always insert a horizontal rule (`----`)** before beginning a new section of the changelog.
4. **Ensure all content is written within** the `<section class="changelog">...</section>` **elements**. Writing outside of this structure will break the UI.

By inserting to these formatting conventions, you'll maintain the integrity and readability of the changelog page.

## Notes

- Do not update any libraries or packages as this could disrupt the template structure and cause it to break.
- Please use kebab-case (this-way) instead of snake_case for naming files and folders
