
## Folder

`apps/<slug>/` holds `app.json` (the manifest: `agenta_app: 1`, `name`, `entry`, `access`,
`data`, `config`), `index.html`, and its data as sibling JSON files. One writer per file: the
app owns what `data` names while it is open; you own config and anything else.
