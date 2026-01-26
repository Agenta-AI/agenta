# Plan

## PR Strategy
| PR | Branch | Status |
|----|--------|--------|
| #3441 | `fix/openapi-generation-issues` | MERGED |
| #3442 | `fix/sdk-local-tracing-types` | MERGED |
| #3561 | `feat/update-fern-sdk-generation` | OPEN - Ready for review |

## Manual Edits (Outside Generated Folder)

These files were manually edited as part of the Fern update (not auto-generated):

| File | Change | Reason |
|------|--------|--------|
| `sdk/scripts/setup_fern.sh` | Fully rewritten | Automates entire generation process |
| `sdk/agenta/client/__init__.py` | Simplified to re-export | `from .backend import *` instead of manual exports |
| `sdk/agenta/client/client.py` | **DELETED** | Old wrapper no longer needed |
| `sdk/agenta/sdk/agenta_init.py` | Fixed import path (line 6) | `from agenta.client.backend.client import AgentaApi` |
| `sdk/agenta/sdk/types.py` | Added local types | `AgentaNodeDto`, `AgentaNodesResponse` (SDK-internal, not in API) |
| `sdk/agenta/client/Readme.md` | Updated documentation | New generation process |

### Post-Generation Step (Not Yet in Script)
```bash
uvx ruff format sdk/agenta/client/backend/
```
This should be added to `setup_fern.sh` for full automation.

## SDK Code Using Fern Client - Test Verification Checklist

### Apps API (`sdk/agenta/sdk/managers/apps.py`)
| Method | Fern Client Call | Tested |
|--------|------------------|--------|
| `AppManager.create()` | `ag.api.apps.create_app()` | [x] |
| `AppManager.acreate()` | `ag.async_api.apps.create_app()` | [x] |
| `AppManager.list()` | `ag.api.apps.list_apps()` | [x] |
| `AppManager.alist()` | `ag.async_api.apps.list_apps()` | [x] |
| `AppManager.update()` | `ag.api.apps.update_app()` | [x] |
| `AppManager.aupdate()` | `ag.async_api.apps.update_app()` | [x] |
| `AppManager.delete()` | `ag.api.apps.remove_app()` | [x] |
| `AppManager.adelete()` | `ag.async_api.apps.remove_app()` | [x] |

### Variants/Configs API (`sdk/agenta/sdk/managers/shared.py`)
| Method | Fern Client Call | Tested |
|--------|------------------|--------|
| `SharedManager.add()` | `ag.api.variants.configs_add()` | [x] |
| `SharedManager.aadd()` | `ag.async_api.variants.configs_add()` | [x] |
| `SharedManager.fetch()` | `ag.api.variants.configs_fetch()` | [x] |
| `SharedManager.afetch()` | `ag.async_api.variants.configs_fetch()` | [x] |
| `SharedManager.list()` | `ag.api.variants.configs_list()` | [x] |
| `SharedManager.alist()` | `ag.async_api.variants.configs_list()` | [x] |
| `SharedManager.history()` | `ag.api.variants.configs_history()` | [x] |
| `SharedManager.ahistory()` | `ag.async_api.variants.configs_history()` | [x] |
| `SharedManager.fork()` | `ag.api.variants.configs_fork()` | [x] |
| `SharedManager.afork()` | `ag.async_api.variants.configs_fork()` | [x] |
| `SharedManager.commit()` | `ag.api.variants.configs_commit()` | [x] |
| `SharedManager.acommit()` | `ag.async_api.variants.configs_commit()` | [x] |
| `SharedManager.deploy()` | `ag.api.variants.configs_deploy()` | [x] |
| `SharedManager.adeploy()` | `ag.async_api.variants.configs_deploy()` | [x] |
| `SharedManager.delete()` | `ag.api.variants.configs_delete()` | [x] |
| `SharedManager.adelete()` | `ag.async_api.variants.configs_delete()` | [x] |

### Fern Types Used by SDK
| Type | Used In | Import Check |
|------|---------|--------------|
| `ConfigDto` | `shared.py` | [x] |
| `ConfigResponseModel` | `shared.py` | [x] |
| `ReferenceRequestModel` | `shared.py` | [x] |
| `SecretDto` | `vault.py` | [x] |
| `StandardProviderKind` | `vault.py` | [x] |
| `StandardProviderDto` | `vault.py` | [x] |
| `StandardProviderSettingsDto` | `vault.py` | [x] |

### Test Suite
All tests verified in `sdk/tests/test_fern_client.py` (66 tests, all passing).

Run tests with:
```bash
cd sdk && poetry run pytest tests/test_fern_client.py -v
```

## Fern Commands Reference
```bash
# Full automated generation
./sdk/scripts/setup_fern.sh https://cloud.agenta.ai/api/openapi.json

# Manual steps (if needed)
cd sdk/agenta/client
rm -rf ./fern
fern init --openapi <url> --organization agenta
fern add fern-python-sdk
# Edit fern/generators.yml to output to ../backend
fern generate
rm -rf ./fern
```

## Recursive Type Fix (handled by script)
Replace in `full_json_input.py`, `full_json_output.py`, `label_json_input.py`, `label_json_output.py`:
```python
# Before
typing.Dict[str, typing.Optional["FullJsonInput"]]
# After
typing.Dict[str, typing.Any]
```
