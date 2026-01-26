# Status

**Last Updated**: 2026-01-26

## Completed
- [x] PR #3441: API fixes for OpenAPI generation (MERGED to main)
- [x] PR #3442: SDK local tracing types (MERGED to release/v0.78.1, re-applied in PR #3)
- [x] Created branch `feat/update-fern-sdk-generation` 
- [x] Updated `sdk/scripts/setup_fern.sh` - fully automated
- [x] Regenerated SDK from https://cloud.agenta.ai/api/openapi.json
- [x] Applied recursive type fixes automatically
- [x] Updated `sdk/agenta/client/__init__.py` - simplified re-export
- [x] Updated `sdk/agenta/client/Readme.md` - new documentation
- [x] Removed old `sdk/agenta/client/client.py` wrapper
- [x] Fixed import in `sdk/agenta/sdk/agenta_init.py`
- [x] Applied local types fix to `sdk/agenta/sdk/types.py`
- [x] Tested SDK imports successfully

## In Progress
- [ ] Create PR #3

## Next Steps
1. Commit changes
2. Create PR
3. Run full SDK tests (if available)
