# docs/: Agenta documentation (Docusaurus)

## Changelog entries feed the release list

`web/packages/agenta-navigation/src/releases/changelog.json` is generated from the
version-tagged entries in `docs/blog/entries/`. The app bundles it, and the website publishes
it as `https://agenta.ai/releases.json`, which self-hosted instances download.

- Never edit `changelog.json` by hand.
- After you add or edit an entry, run `pnpm --filter @agenta/navigation generate:releases`
  from `web/` and commit the regenerated file in the same PR.
- CI runs `check:releases` and fails when the file does not match the entries.

Changelog writing and the full workflow: the `create-changelog-announcement` skill.
