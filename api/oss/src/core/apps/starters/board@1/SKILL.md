---
name: board
version: 1
kind: app-starter
access: read-write
config_keys: [title, columns]
data_files: [board.json]
---
Use this when the person wants a kanban, to-do or status board: cards that move between named columns.

- `config.json`: `title` and `columns` (`[{id, title}]`). Write it after `create_app` when the person named their columns.
- `board.json`: `{columns: [{id, title, cards: [{id, text, done?}]}]}`. Leave it out for an empty board, or seed it from the person's list.
- The app saves after every move; the agent may edit `board.json` too, the app re-reads on change.
