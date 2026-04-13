# Manual HTTP Tests

REST Client `.http` files for exploratory and manual testing.

## Setup

Open with the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) VS Code extension.

### Required variables

Create a `.env` file or set these via the REST Client `rest-client.environmentVariables` setting:

```json
{
  "local": {
    "api_url": "http://localhost/api",
    "services_url": "http://localhost/services",
    "auth_key": "ApiKey <your-key>",
    "project_id": "<your-project-uuid>"
  }
}
```

## Scenarios

| File | URI | Description |
|------|-----|-------------|
| `01-auto-exact-match-lifecycle.http` | `agenta:builtin:auto_exact_match:v0` | Catalog → create → deploy → invoke (exact match evaluator) |
| `02-completion-lifecycle.http` | `agenta:builtin:completion:v0` | Catalog → create → deploy → invoke (completion application) |
| `03-completion-with-evaluation.http` | `agenta:builtin:completion:v0` + `agenta:builtin:auto_regex_test:v0` | End-to-end: completion app + regex evaluator linked via trace |
| `04-auto-contains-lifecycle.http` | `agenta:builtin:auto_contains:v0` | Catalog → create → deploy → invoke (contains evaluator) |
| `05-auto-contains-any-lifecycle.http` | `agenta:builtin:auto_contains_any:v0` | Catalog → create → deploy → invoke (contains-any evaluator) |
| `06-auto-contains-all-lifecycle.http` | `agenta:builtin:auto_contains_all:v0` | Catalog → create → deploy → invoke (contains-all evaluator) |
| `07-auto-starts-with-lifecycle.http` | `agenta:builtin:auto_starts_with:v0` | Catalog → create → deploy → invoke (starts-with evaluator) |
| `08-auto-ends-with-lifecycle.http` | `agenta:builtin:auto_ends_with:v0` | Catalog → create → deploy → invoke (ends-with evaluator) |
| `09-auto-regex-test-lifecycle.http` | `agenta:builtin:auto_regex_test:v0` | Catalog → create → deploy → invoke (regex test evaluator) |
| `10-auto-contains-json-lifecycle.http` | `agenta:builtin:auto_contains_json:v0` | Catalog → create → deploy → invoke (contains-JSON evaluator) |
| `11-auto-json-diff-lifecycle.http` | `agenta:builtin:auto_json_diff:v0` | Catalog → create → deploy → invoke (JSON diff evaluator) |
| `12-auto-levenshtein-distance-lifecycle.http` | `agenta:builtin:auto_levenshtein_distance:v0` | Catalog → create → deploy → invoke (Levenshtein distance evaluator) |
| `13-auto-similarity-match-lifecycle.http` | `agenta:builtin:auto_similarity_match:v0` | Catalog → create → deploy → invoke (Jaccard similarity evaluator) |
| `14-auto-semantic-similarity-lifecycle.http` | `agenta:builtin:auto_semantic_similarity:v0` | Catalog → create → deploy → invoke (embedding-based semantic similarity; requires LLM API key) |
| `15-auto-ai-critique-lifecycle.http` | `agenta:builtin:auto_ai_critique:v0` | Catalog → create → deploy → invoke (LLM-as-a-judge; requires LLM API key) |
| `16-auto-webhook-test-lifecycle.http` | `agenta:builtin:auto_webhook_test:v0` | Catalog → create → deploy → invoke (webhook evaluator; requires live endpoint) |
| `17-auto-custom-code-run-lifecycle.http` | `agenta:builtin:auto_custom_code_run:v0` | Catalog → create → deploy → invoke (built-in code evaluator, Python/JS/TS runtime) |
| `18-custom-code-lifecycle.http` | `agenta:custom:code:v0` | Catalog → create → deploy → invoke (user-provided custom code workflow, multiple invoke paths) |
| `19-field-match-test-lifecycle.http` | `agenta:builtin:field_match_test:v0` | Catalog → create → deploy → invoke (JSON field match evaluator, deprecated) |
| `20-json-multi-field-match-lifecycle.http` | `agenta:builtin:json_multi_field_match:v0` | Catalog → create → deploy → invoke (multi-field JSON match evaluator) |
| `21-match-lifecycle.http` | `agenta:builtin:match:v0` | Catalog → create → deploy → invoke (generic rule-based matcher with recursive matcher tree) |
| `22-chat-lifecycle.http` | `agenta:builtin:chat:v0` | Catalog → create → deploy → invoke (chat application) |
