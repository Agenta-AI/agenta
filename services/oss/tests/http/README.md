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

| File | Description |
|------|-------------|
| `01-auto-exact-match-lifecycle.http` | Catalog → create → deploy → invoke (auto_exact_match) |
