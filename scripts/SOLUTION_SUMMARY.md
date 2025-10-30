# Agenta API 500 Error - Root Cause & Solution

## Problem Summary

**Error:** 500 Internal Server Error when accessing `/api/apps/get_variant_by_env` endpoint

**Root Cause:** The API endpoint `/api/apps/get_variant_by_env` in `app_router.py:169` calls a non-existent function `db_manager.get_app_variant_by_app_name_and_environment()`. This function was removed in upstream commit `deb7c1860` as "unused" but the endpoint still exists in your deployment.

**Error Message:**
```
AttributeError: module 'oss.src.services.db_manager' has no attribute 'get_app_variant_by_app_name_and_environment'
```

**Location in Code:** `api/oss/src/routers/app_router.py:169`

---

## Solution Implemented

Instead of fixing the broken endpoint, we created a **standalone Python script** that uses the correct API approach to retrieve prompt configurations.

### Script: `scripts/get_prompt.py`

**Features:**
- ✅ Uses correct Agenta API endpoints (environments + variants)
- ✅ Configurable environment, app ID, and app slug
- ✅ Automatic API key loading from `scripts/.env`
- ✅ Inline dependencies with `uv run` (no installation needed)
- ✅ JSON output with optional revision history
- ✅ Save to file or print to stdout

---

## Usage

### Basic Usage

Get production prompt:
```bash
uv run scripts/get_prompt.py \
  --environment production \
  --app-id 019a0b13-7dac-7190-affa-e54d3a5a40d6
```

Get with revision history:
```bash
uv run scripts/get_prompt.py \
  --environment production \
  --app-id 019a0b13-7dac-7190-affa-e54d3a5a40d6 \
  --include-revisions
```

Save to file:
```bash
uv run scripts/get_prompt.py \
  --environment production \
  --app-id 019a0b13-7dac-7190-affa-e54d3a5a40d6 \
  --output prompt.json
```

### Configuration

Create `scripts/.env`:
```bash
AGENTA_BRAVETECH_API_KEY=your_api_key_here
AGENTA_API_URL=https://agenta.bravetech.io
```

The script automatically loads this file.

---

## How It Works

The script uses the correct multi-step API approach:

1. **Fetch environments** for the app:
   ```
   GET /api/apps/{app_id}/environments
   ```

2. **Find the target environment** (e.g., "production")

3. **Extract the deployed variant ID** from the environment

4. **Fetch variant details**:
   ```
   GET /api/variants/{variant_id}
   ```

5. **Optionally fetch revisions**:
   ```
   GET /api/variants/{variant_id}/revisions
   ```

This approach bypasses the broken `/api/apps/get_variant_by_env` endpoint entirely.

---

## Why the Original Endpoint Failed

### Timeline

1. **2023-09-18:** Function `get_app_variant_by_app_name_and_environment` was added (commit `df5054d04`)
2. **2024-01-17:** Function and endpoint removed as "unused" (commit `deb7c1860`)
3. **2025-10-22:** Your deployment still has the endpoint but not the function

### The Issue

The Docker image you're using (`ghcr.io/agenta-ai/agenta-web:latest`) was built from code that:
- Has the endpoint defined in `app_router.py`
- But doesn't have the corresponding function in `db_manager.py`

This created a mismatch between the router and the service layer.

---

## Alternative Fixes (Not Implemented)

If you want to fix the broken endpoint instead:

### Option 1: Update to Latest Version
```bash
ssh root@91.98.229.196
cd /opt/agenta
git pull origin main
cd hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml pull
docker compose -f docker-compose.gh.ssl.yml up -d
```

### Option 2: Remove the Broken Endpoint

Edit `api/oss/src/routers/app_router.py` and remove the `get_variant_by_env` function (lines 128-182).

### Option 3: Implement the Missing Function

Add the function back to `db_manager.py` to make the endpoint work again. However, this is not recommended since it was intentionally removed upstream.

---

## Files Created

1. **`scripts/get_prompt.py`** - Main script with inline dependencies
2. **`scripts/.env`** - Configuration file for API key
3. **`scripts/.env.example`** - Example configuration template
4. **`scripts/README.md`** - Detailed usage documentation
5. **`scripts/requirements.txt`** - Dependencies list (not needed with `uv run`)

---

## Tested & Working

✅ Script successfully retrieves production prompt from `https://agenta.bravetech.io`

✅ API authentication working with `AGENTA_BRAVETECH_API_KEY`

✅ JSON output includes full prompt configuration with system messages

✅ Revision history retrieval working

✅ File output working

---

## Next Steps

You can now:

1. **Access your prompts programmatically** using the script
2. **Integrate the script** into your CI/CD pipeline
3. **Use the output** to version control your prompts
4. **Monitor changes** by comparing revision history

---

## Summary

**Problem:** Broken API endpoint causing 500 errors

**Solution:** Created working script that uses correct API approach

**Outcome:** You can now reliably retrieve your prompt configurations without fixing the broken endpoint

**Time to Solution:** ~30 minutes of investigation + script development
