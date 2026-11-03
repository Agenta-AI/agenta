# Contributing a template

This folder is the bundled template catalog. A merged template appears in the
app's template gallery with the next release, and on the website with the next
website build. You add it with one pull request.

## What a template is made of

| Path | What it holds |
| --- | --- |
| `packages/<key>/<version>/` | The package: `plugin.json`, `ai.agenta/agents.json`, and the files it names (`AGENTS.md`, `SETUP.md`, skills). |
| `catalog.json` | One record per template key: `latest`, `versions`, and the `metadata` shown in the gallery and on the website. |
| `authors/<id>.json` | One document per author. Templates point to it with `metadata.author_id`. |

Published versions never change. To change a template, add a new version
folder, map it in `versions`, and move `latest` to it. CI rejects any change
to the files of a version that is already on the base branch.

## Steps

1. **Pick a key.** Use a lowercase slug, for example `invoice-chaser`. The key
   is stable: the website "Use it for free" button and saved agents refer to
   it.
2. **Add the package.** Create `packages/<key>/1.0.0/`. Start from an existing
   package, such as `packages/changelog-writer/1.0.0/`. Set
   `plugin.json` `name` to the key and `version` to `1.0.0`. Keep
   `ai.agenta/agents.json` at `schema_version: 1` with exactly one agent. Do not
   put images or videos in the package.
3. **Add or reuse your author.** If `authors/<id>.json` already exists for you,
   reuse it. Otherwise add one. The file name must equal its `id`:

   ```json
   {
     "schema_version": 1,
     "id": "jane-doe",
     "name": "Jane Doe",
     "bio": "Builds support agents.",
     "links": [{"kind": "github", "url": "https://github.com/jane-doe"}]
   }
   ```

4. **Add the catalog record.** Add `"<key>"` under `templates` in
   `catalog.json`. Copy the shape of an existing record. Set `latest`,
   `versions` (`{"1.0.0": "packages/<key>/1.0.0"}`) and `metadata`, with
   `author_id` set to your author id. `display.connection_tools` keys must be
   connection keys that your package declares. Add `media` entries
   (`kind` `image` or `video`, `url`, `alt`) only with hosted URLs.
5. **Regenerate the website data.** From `api/`:

   ```sh
   uv run python -m oss.src.core.agent_templates.marketplace website
   ```

   Commit the updated `web/website/src/data/templates.json`. Do not edit that
   file by hand.
6. **Validate locally.** From `api/`, with `origin/main` fetched:

   ```sh
   uv run python -m oss.src.core.agent_templates.marketplace validate --base-ref origin/main
   ```

   The command parses every package and checks the catalog and author
   references. It prints each problem with the template key, version or author
   id. It prints `Template catalog, authors and packages are valid.` on
   success.
7. **Open a pull request.** Include the template key, version and package path
   in the description. The `check template catalog` workflow runs the same two
   commands with `--check` for the website data.

## What CI rejects

- A package that fails the package parser, including an unsupported
  `agents.json` `schema_version`.
- A catalog record that points to a missing folder, or a package folder that no
  catalog version maps.
- A template whose `author_id` has no `authors/<id>.json`.
- A changed, added or removed file inside a version that is already published.
- Website data that does not match the catalog.
