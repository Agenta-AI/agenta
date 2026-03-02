# Plan

## PR Strategy
| PR | Branch | Status |
|----|--------|--------|
| #3441 | `fix/openapi-generation-issues` | MERGED |
| #3442 | `fix/sdk-local-tracing-types` | MERGED |
| #3 | `feat/update-fern-sdk-generation` | IN PROGRESS |

## PR 3: Fern Generation Update

### Phase 1: Update setup_fern.sh
1. Fix path: `core/agenta-cli/agenta/client` → `sdk/agenta/client`
2. Update `generators.yml` format for new Fern
3. Add recursive type fix post-processing (patch FullJson*, LabelJson* files)
4. Remove obsolete Score schema patch

### Phase 2: Regenerate SDK
1. Start local API server (needs .env setup)
2. Run `fern init --openapi http://localhost:8000/api/openapi.json`
3. Run `fern generate`
4. Apply recursive type fixes
5. Simplify `sdk/agenta/client/__init__.py` to re-export from backend

### Phase 3: Update Documentation
1. Update `sdk/agenta/client/Readme.md` with new process
2. Document known issues and workarounds

## Fern Commands Reference
```bash
cd sdk/agenta/client
rm -rf ./fern
fern init --openapi <url> --organization agenta
fern add fern-python-sdk
# Edit fern/generators.yml to output to ../backend
fern generate
rm -rf ./fern
```

## Recursive Type Fix (post-generation)
Replace in `full_json_input.py`, `full_json_output.py`, `label_json_input.py`, `label_json_output.py`:
```python
# Before
typing.Dict[str, typing.Optional["FullJsonInput"]]
# After
typing.Dict[str, typing.Any]
```
