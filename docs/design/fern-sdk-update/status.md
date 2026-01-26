# Status

**Last Updated**: 2026-01-26

## Completed
- [x] PR #3441: API fixes for OpenAPI generation (MERGED to main)
- [x] PR #3442: SDK local tracing types (MERGED to release/v0.78.1, re-applied in PR #3561)
- [x] Created branch `feat/update-fern-sdk-generation` 
- [x] Updated `sdk/scripts/setup_fern.sh` - fully automated (now includes ruff format)
- [x] Regenerated SDK from https://cloud.agenta.ai/api/openapi.json
- [x] Applied recursive type fixes automatically
- [x] Updated `sdk/agenta/client/__init__.py` - simplified re-export
- [x] Updated `sdk/agenta/client/Readme.md` - new documentation
- [x] Removed old `sdk/agenta/client/client.py` wrapper
- [x] Fixed import in `sdk/agenta/sdk/agenta_init.py`
- [x] Applied local types fix to `sdk/agenta/sdk/types.py`
- [x] Tested SDK imports successfully
- [x] Created PR #3561
- [x] Fixed ruff formatting (474 files)
- [x] All CI checks passing
- [x] Created test suite `sdk/tests/test_fern_client.py` (66 tests, all passing)
- [x] Documented manual edits in plan.md
- [x] Verified all SDK code using Fern client works

## Ready for Review
PR #3561: https://github.com/Agenta-AI/agenta/pull/3561

## Test Suite
Run tests with:
```bash
cd sdk && poetry run pytest tests/test_fern_client.py -v
```

## Next Steps
1. Get PR reviewed and merged
