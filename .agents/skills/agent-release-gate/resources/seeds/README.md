# Seeds

Representative green `results.json` from real gate runs, kept as regression-seed references — the
shape a healthy run produces, and a baseline to diff a future run against.

- `product-C2-full-green.results.json` — `qa_product.py` on cell C2 (Claude/daytona, funded vault
  key), all six journeys PASS.
- `longctx-daytona-all-green.results.json` — `qa_longctx.py` on daytona, all three probes (gmail,
  memory, concurrent) PASS.

These are captured evidence, not fixtures a test loads. Live runs write to `./qa-gate-runs/`.

The canary tokens the probes plant and read back (the `QA-MEM-*`, `QA-CONC*`, `QA-MOUNT-*`,
`QA-BASH-*` values) are replaced here with the fixed placeholder `QA-TOKEN-SANITIZED`. The JSON
structure is untouched — only those per-run random token values were scrubbed.
