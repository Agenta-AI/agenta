
## Folder

`apps/<slug>/` holds `app.json` (the manifest: `agenta_app: 1`, `name`, `entry`, `access`,
`data`, `config`), `index.html`, and its data as sibling JSON files. The app owns what `data`
names while it is open; you own config and the rest. You may write data too, but read it
first: your writes are unconditional.
