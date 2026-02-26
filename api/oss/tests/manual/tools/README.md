# Tools Manual Tests

Manual test scripts for the Tools Gateway feature.

## Catalog Generation

### `generate.py`

Generates the initial Composio catalog file by fetching all integrations and actions from the Composio API.

**Persistence Architecture:**
- **Redis**: Primary cache (persistent, shared across containers)
- **File**: Local backup (ephemeral, per-container, serves as fallback)

Background jobs automatically refresh from API → update both file + Redis.
This script is ONLY needed for manual catalog generation or testing.

**When to use:**
- Testing catalog refresh locally without waiting for startup/cron
- Generating catalog file for inspection/debugging
- OPTIONAL: Pre-generating catalog before first deployment (startup job will do this automatically)

**Normal Operations:**
In production, you don't need to run this script. The system works as follows:
1. **Container startup**: Automatically refreshes catalog from API
2. **Hourly cron**: Automatically refreshes catalog from API
3. Both update file (local backup) + Redis (persistent store)

**Usage:**

```bash
# From the API directory
cd api

# Set your API key
export COMPOSIO_API_KEY=your_key

# Run the script (directory will be created automatically)
python oss/src/core/tools/providers/composio/generate.py

# Or with command-line override
python oss/src/core/tools/providers/composio/generate.py --api-key YOUR_KEY

# Custom API URL
export COMPOSIO_API_URL=https://custom.composio.dev/api/v3
python oss/src/core/tools/providers/composio/generate.py
```

**Environment Variables:**
- `COMPOSIO_API_KEY` - Your Composio API key (required)
- `COMPOSIO_API_URL` - Custom API URL (optional, defaults to production)

**Output:**
- File: `api/oss/src/core/tools/providers/composio/catalog.json`
- Directory is created automatically if it doesn't exist

**What it does:**
1. Fetches all integrations from Composio API (paginated)
2. For each integration, fetches all actions (paginated)
3. Saves everything to `catalog.json`

**Note:**
This generates the file only - it does NOT populate Redis.
Background jobs handle the complete flow (file + Redis).

**Example output:**
```
============================================================
Composio Catalog Generator
============================================================

📡 Connecting to Composio API: https://backend.composio.dev/api/v3

🔄 Fetching integrations...
✅ Fetched 150 integrations

🔄 [1/150] Fetching actions for Gmail...
   ✅ 25 actions
🔄 [2/150] Fetching actions for Slack...
   ✅ 30 actions
...

============================================================
📊 Summary
============================================================
Integrations: 150
Actions:      4500

📁 Catalog saved to: api/oss/src/core/tools/providers/composio/catalog.json

✅ Done! The catalog is stored alongside the provider module.
```

## HTTP Tests

The `*.http` files can be used with REST clients (VS Code REST Client, IntelliJ HTTP Client, etc.) to test the API endpoints manually.

### Files:
- `catalog.http` - Test catalog browsing endpoints
- `connections.http` - Test connection management endpoints
- `query.http` - Test tool query endpoint

### Setup:
1. Update the `@base_url` and `@auth_key` variables in each file
2. Start the API server
3. Run requests directly from your editor
