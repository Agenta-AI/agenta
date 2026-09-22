
## Custom app rules

- Layout with the kit classes only: `ag-app`, `ag-toolbar`, `ag-btn`, `ag-btn-primary`,
  `ag-input`, `ag-select`, `ag-check`, `ag-card`, `ag-columns`, `ag-column`, `ag-list`,
  `ag-grid`, `ag-badge`, `ag-empty`, `ag-toast`. Inline CSS only for what they do not cover.
- No external scripts, styles, fonts or images; the page cannot reach the network.
- Wait for `agenta.ready`; treat `not_found` as empty; respect `canWrite === false` by showing
  edits as unsaved instead of failing.
- Save whole files, debounced, after each change; handle `conflict` by re-read and reapply.
