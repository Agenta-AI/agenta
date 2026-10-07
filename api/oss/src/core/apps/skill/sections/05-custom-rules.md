
## Custom app rules

- Layout with the kit classes only: `ag-app`, `ag-toolbar`, `ag-btn`, `ag-btn-primary`,
  `ag-input`, `ag-select`, `ag-check`, `ag-card`, `ag-columns`, `ag-column`, `ag-list`,
  `ag-grid`, `ag-badge`, `ag-empty`, `ag-toast`. Inline CSS only for what they do not cover.
- Keep assets self-contained. Do not assume network isolation or embed secrets.
- Wait for `agenta.ready`; treat `not_found` as empty; while `canWrite` is false, show edits
  as unsaved instead of failing; on `access`, re-render and save them.
- Save whole files, debounced, after each change; handle `conflict` by re-read and reapply once.
