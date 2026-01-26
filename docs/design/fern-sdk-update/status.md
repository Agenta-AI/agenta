# Status

**Last Updated**: 2026-01-26

## Completed

- [x] PR #3441: API fixes for OpenAPI generation (MERGED to main)
- [x] PR #3442: SDK local tracing types (MERGED to release/v0.78.1)
- [x] Updated `sdk/scripts/setup_fern.sh` (fully automated, includes ruff format)
- [x] Regenerated SDK from https://cloud.agenta.ai/api/openapi.json
- [x] Applied recursive type fixes automatically
- [x] Updated `sdk/agenta/client/__init__.py` (simplified re-export)
- [x] Updated `sdk/agenta/client/Readme.md` (new documentation)
- [x] Removed old `sdk/agenta/client/client.py` wrapper
- [x] Fixed import in `sdk/agenta/sdk/agenta_init.py`
- [x] Applied local types fix to `sdk/agenta/sdk/types.py`
- [x] Fixed ruff formatting (474 files)

## Usage

To regenerate the Fern SDK:

```bash
./sdk/scripts/setup_fern.sh https://cloud.agenta.ai/api/openapi.json
```

The script handles:
1. Downloading the OpenAPI spec
2. Running Fern generation
3. Applying recursive type fixes
4. Formatting with ruff

## Next Steps

- Integration tests for the new SDK (separate PR)
