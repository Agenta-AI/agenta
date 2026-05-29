# Agenta MCP Server — Research Notes

Every fact below is tagged as `CONFIRMED-SPEC`, `CONFIRMED-SOURCE`, `CONFIRMED-LIVE`, `INFERRED`, or `OPEN`.

## 1A — Spec inventory + auth

- `docs/docs/reference/openapi.json` declares OpenAPI `3.1.0`. **[CONFIRMED-SPEC]**
- The spec has a single security scheme named `APIKeyHeader` with `type: apiKey`, `in: header`, and `name: Authorization`; the root-level `security` array applies it globally as `[{"APIKeyHeader": []}]`. **[CONFIRMED-SPEC]**
- The spec `servers` block is `[ {"url": "/api"}, {"url": "https://eu.cloud.agenta.ai/api"} ]`. **[CONFIRMED-SPEC]**
- Agenta docs use `https://cloud.agenta.ai/api` in public examples and self-hosting docs describe `AGENTA_API_URL=http://localhost/api`; the API env default is also `http://localhost/api`. **[CONFIRMED-SOURCE]**
- API-key auth uses `Authorization: ApiKey <key>`: backend auth accepts configured token prefixes including `ApiKey `, and shared context parsing recognizes only `ApiKey ` or `Secret ` for tenant-scoped credentials. Bare API keys are not accepted by these source paths. The MCP server should default `AGENTA_AUTH_SCHEME=ApiKey` and keep it configurable. **[CONFIRMED-SOURCE]**

## 1B — Uniform `/simple/*` pattern

### Applications

- `POST /simple/applications/` accepts `{"application": {...}}` (`SimpleApplicationCreateRequest`) and returns `{"count", "application"}` (`SimpleApplicationResponse`). **[CONFIRMED-SPEC]**
- `POST /simple/applications/query` accepts `{"application": filter, "application_refs": [...], "include_archived": bool, "windowing": {...}}` and returns `{"count", "applications"}`. **[CONFIRMED-SPEC]**
- `GET /simple/applications/{application_id}` returns `{"count", "application"}`. **[CONFIRMED-SPEC]**
- `PUT /simple/applications/{application_id}` accepts `{"application": {...}}` and returns `{"count", "application"}`. **[CONFIRMED-SPEC]**

### Evaluators

- `POST /simple/evaluators/` accepts `{"evaluator": {...}}` and returns `{"count", "evaluator"}`. **[CONFIRMED-SPEC]**
- `POST /simple/evaluators/query` accepts `{"evaluator": filter, "evaluator_refs": [...], "include_archived": bool, "windowing": {...}}` and returns `{"count", "evaluators"}`. **[CONFIRMED-SPEC]**
- `GET /simple/evaluators/{evaluator_id}` returns `{"count", "evaluator"}`. **[CONFIRMED-SPEC]**
- `PUT /simple/evaluators/{evaluator_id}` accepts `{"evaluator": {...}}` and returns `{"count", "evaluator"}`. **[CONFIRMED-SPEC]**
- `GET /simple/evaluators/templates?include_archived=false` returns `{"count", "templates"}`; this is a special read endpoint used by v1. **[CONFIRMED-SPEC]**

### Testsets

- `POST /simple/testsets/` accepts `{"testset": {...}}` and returns `{"count", "testset"}`. **[CONFIRMED-SPEC]**
- `POST /simple/testsets/query` accepts `{"testset": filter, "testset_refs": [...], "include_archived": bool, "windowing": {...}}` and returns `{"count", "testsets"}`. **[CONFIRMED-SPEC]**
- `GET /simple/testsets/{testset_id}` returns `{"count", "testset"}`. **[CONFIRMED-SPEC]**
- `PUT /simple/testsets/{testset_id}` accepts `{"testset": {...}}` and returns `{"count", "testset"}`. **[CONFIRMED-SPEC]**
- File upload exists as `POST /simple/testsets/upload` and `POST /simple/testsets/{testset_id}/upload`; responses use `SimpleTestsetResponse`. The multipart schemas require `file` and accept `file_type` (`csv` or `json`, default `csv`), `testset_name`, `testset_description`, `testset_tags`, and `testset_meta`; create-from-file also accepts `testset_slug`. **[CONFIRMED-SPEC]**

### Evaluations

- `POST /simple/evaluations/` accepts `{"evaluation": {...}}` and returns `{"count", "evaluation"}`. **[CONFIRMED-SPEC]**
- `POST /simple/evaluations/query` accepts `{"evaluation": filter, "windowing": {...}}` and returns `{"count", "evaluations"}`. This deviates from the generic resource-ref pattern: no `evaluation_refs` and no `include_archived` field are present in the simple query schema. **[CONFIRMED-SPEC]**
- `GET /simple/evaluations/{evaluation_id}` returns `{"count", "evaluation"}`. **[CONFIRMED-SPEC]**
- Evaluation edit is `PATCH /simple/evaluations/{evaluation_id}`, not `PUT`, and accepts `{"evaluation": {...}}`. v1 only creates and reads evaluations, so this deviation does not back a v1 edit tool. **[CONFIRMED-SPEC]**

### Environments

- `POST /simple/environments/` accepts `{"environment": {...}}` and returns `{"count", "environment"}`. **[CONFIRMED-SPEC]**
- `POST /simple/environments/query` accepts `{"environment": filter, "environment_refs": [...], "include_archived": bool, "windowing": {...}}` and returns `{"count", "environments"}`. **[CONFIRMED-SPEC]**
- `GET /simple/environments/{environment_id}` returns `{"count", "environment"}`. **[CONFIRMED-SPEC]**
- `PUT /simple/environments/{environment_id}` accepts `{"environment": {...}}` and returns `{"count", "environment"}`. **[CONFIRMED-SPEC]**

## 1C — Create payload shapes

- Application, evaluator, testset, environment, and evaluation simple create schemas all use common header/metadata fields where applicable: `flags`, `tags`, `meta`, `name`, `description`, `slug`, and `data`; evaluations additionally include `version` defaulting to `2025-07-14` and have no `slug`. **[CONFIRMED-SPEC]**
- Application `data` keys are `uri`, `url`, `headers`, `runtime`, `script`, `schemas`, and `parameters`; `schemas` contains `parameters`, `inputs`, and `outputs`; `parameters` is an object of arbitrary JSON values. **[CONFIRMED-SPEC]**
- Evaluator `data` has the same shape as application `data`: `uri`, `url`, `headers`, `runtime`, `script`, `schemas`, and `parameters`; `parameters` is the template settings payload. **[CONFIRMED-SPEC]**
- Testset `data` is `TestsetRevisionData` with `testcase_ids?: UUID[]` and `testcases?: Testcase[]`. Each inline testcase can carry `flags`, `tags`, `meta`, and `data`; testcase row values live in `testcase.data`. **[CONFIRMED-SPEC]**
- Environment `data` is `EnvironmentRevisionData` with `references`. **[CONFIRMED-SPEC]**
- Application flags include `is_application`, `is_llm`, and `is_chat` as well as other workflow flags (`is_evaluator`, `is_snippet`, `is_managed`, `is_custom`, `is_hook`, `is_code`, `is_match`, `is_feedback`, `has_url`, `has_script`, `has_handler`). **[CONFIRMED-SPEC]**
- Evaluator flags use `SimpleEvaluatorFlags`, which is the same workflow flag model and includes `is_evaluator`; v1 create helpers should set `is_evaluator=true` by default for evaluator creation. **[CONFIRMED-SPEC]**

## 1D — Under-specified items resolved from source

### `create_evaluation` step shape

- The real simple evaluation step target type is `Target = Union[List[UUID], Dict[UUID, Origin]]` where `Origin = Literal["custom", "human", "auto"]`. **[CONFIRMED-SOURCE]**
- `SimpleEvaluationData` fields are `status`, `query_steps`, `testset_steps`, `application_steps`, `evaluator_steps`, and `repeats`; each `*_steps` field uses the target type above. **[CONFIRMED-SOURCE]**
- Source conversion confirms the IDs in `testset_steps`, `application_steps`, and `evaluator_steps` are revision IDs, not artifact IDs: the service calls `fetch_testset_revision`, `fetch_application_revision`, and `fetch_evaluator_revision` for those IDs. **[CONFIRMED-SOURCE]**
- If a steps field is a list of UUIDs, the service converts it to a mapping with defaults (`auto` for testsets/applications/evaluators). The frontend creates evaluations with object mappings such as `{"<revision_id>": "auto"}` for testset, application, and evaluator revision IDs. **[CONFIRMED-SOURCE]**
- v1 `create_evaluation` will accept `testset_revision_id`, `application_revision_ids`, and `evaluator_revision_ids`, and will construct `data.testset_steps`, `data.application_steps`, and `data.evaluator_steps` as `{revision_id: "auto"}` mappings. It will also expose optional passthrough `data` for advanced confirmed fields (`query_steps`, custom origins, `repeats`, `status`) without inventing nested fields. **[CONFIRMED-SOURCE]**

### Evaluator settings shape per template

- `GET /simple/evaluators/templates` returns `EvaluatorTemplatesResponse` with `templates[]` containing `name`, `key`, `direct_use`, `settings_presets`, `settings_template`, `outputs_schema`, `description`, `oss`, `requires_llm_api_keys`, `tags`, and `archived`. **[CONFIRMED-SPEC]**
- The backend source for template data is `api/oss/src/resources/evaluators/evaluators.py`; the route returns `get_all_evaluators()` filtered by `include_archived`. **[CONFIRMED-SOURCE]**
- Template settings are not a single universal schema. Each template has a `settings_template` map of parameter names to UI/schema descriptors, and `settings_presets[]` may provide named `values`. Therefore v1 `create_evaluator` must accept a free-form `parameters` dict that the caller derives from a selected template's `settings_template`/preset. **[CONFIRMED-SOURCE]**
- Non-archived examples confirmed in source include `auto_exact_match` (`correct_answer_key`, direct use), `auto_contains_json` (empty settings, direct use), `auto_similarity_match` (`similarity_threshold`, `correct_answer_key`), `auto_regex_test` (`regex_pattern`, `regex_should_match`, presets), `auto_webhook_test` (`requires_llm_api_keys`, `webhook_url`, `correct_answer_key`), `auto_ai_critique` (LLM prompt/model/json_schema settings and presets), `auto_json_diff`, `auto_semantic_similarity`, and `auto_levenshtein_distance`. **[CONFIRMED-SOURCE]**

### `get_application_schema`

- Simple application fetch/query responses merge the current variant/revision `data` onto the application row; router docstrings state returned `data` includes `url`, `parameters`, and JSON `schemas` for inputs, outputs, and parameters. **[CONFIRMED-SOURCE]**
- The spec confirms `SimpleApplicationData.schemas` is `JsonSchemas` with `parameters`, `inputs`, and `outputs`. **[CONFIRMED-SPEC]**
- Workflow catalog code normalizes and populates `data.schemas.parameters` and extracts defaults into `data.parameters` for catalog templates. **[CONFIRMED-SOURCE]**
- v1 `get_application_schema` should fetch the simple application and return `application.data.schemas` (including `schemas.parameters` when populated), plus current `data.parameters` for defaults/current prompt/config. **[CONFIRMED-SOURCE]**

### `windowing`

- The `Windowing` schema has keys `newest?: date-time`, `oldest?: date-time`, `next?: UUID`, `limit?: integer`, `order?: "ascending" | "descending"`, `interval?: integer`, and `rate?: number`. **[CONFIRMED-SPEC]**
- Query request schemas for simple applications, evaluators, testsets, evaluations, and environments all accept `windowing?: Windowing`. **[CONFIRMED-SPEC]**
- v1 list tools will expose `limit`, `next`, and `include_archived` where the underlying resource supports it; the generated request will place pagination under `windowing`. **[CONFIRMED-SPEC]**

## 1E — Live validation

- This environment does not provide `AGENTA_API_KEY` or `AGENTA_API_URL`, so live reads were not executed. **[OPEN]**
- Because auth prefix and response envelopes are confirmed from spec/source, the missing live validation does not block v1 tool implementation. Before public release, run `clients/mcp-python/scripts/smoke.py` with real `AGENTA_API_KEY` and `AGENTA_API_URL` to validate `list_applications` and `list_evaluator_templates` against the target instance. **[OPEN]**

## 1F — Hosting facts

- `hosting/docker-compose/oss/docker-compose.gh.yml` defines the API compose service as `api`, runs gunicorn on `0.0.0.0:8000`, joins network `agenta-oss-gh-network`, sets `SCRIPT_NAME=/api`, and has Traefik labels routing `PathPrefix(`/api/`)` to service port `8000` through a `stripprefix` middleware for `/api`. **[CONFIRMED-SOURCE]**
- After Traefik strips `/api`, the API serves `/simple/*` at root on container port `8000`; an in-cluster sibling should use `AGENTA_API_URL=http://api:8000` rather than the public `/api` URL. **[CONFIRMED-SOURCE]**
- The shared compose network is `agenta-oss-gh-network`. **[CONFIRMED-SOURCE]**
- Non-Compose deployment is out of scope for the v1 MCP release. Docker Compose is the supported self-hosted deployment path for this package. **[CONFIRMED-SOURCE]**

## Phase 1 gate

- No `INFERRED` item backs a v1 tool. **[CONFIRMED-SOURCE]**
- Remaining `OPEN` items: live read validation against a real Agenta instance; public per-user OAuth design. Neither blocks the v1 implementation because v1 ships internal-first with a single env API key and a smoke script for target-instance verification. **[OPEN]**
- Public multi-tenant OAuth is v2 and must solve two trust boundaries: MCP client/user to hosted MCP server, and hosted MCP server to Agenta API with per-user/per-tenant credentials instead of one shared `AGENTA_API_KEY`. **[OPEN]**
