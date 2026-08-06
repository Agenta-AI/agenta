#!/usr/bin/env bash
#
# Manual test script for GitHub webhook integrations.
#
# Required env vars:
#   AGENTA_API_URL   — Agenta API base URL (e.g. http://localhost/api)
#   AGENTA_API_KEY   — Agenta API key
#   GITHUB_TOKEN     — GitHub PAT with repo scope
#
# Usage:
#   Run individual sections by copying the curl commands, or source the
#   whole file (it will exit on first error).
#
# Workflow:
#   1. Create subscriptions (Section 2)
#   2. Test subscriptions   (Section 3) — sets is_valid=true
#   3. Trigger a real event (commit a revision in the UI)
#   4. Verify both workflows ran in GitHub Actions
#
set -euo pipefail

REPO="Agenta-AI/agenta-webhook-test"

# ============================================================================
# 1. Direct GitHub API smoke tests
#    Verify PAT and workflow files are working before involving Agenta.
# ============================================================================

# 1a. repository_dispatch — triggers .github/workflows/agenta-webhook-test.yml
echo "--- 1a. repository_dispatch (direct) ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST \
  "https://api.github.com/repos/${REPO}/dispatches" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{
    "event_type": "environments.revisions.committed",
    "client_payload": {
      "event_id": "00000000-0000-0000-0000-000000000001",
      "event_type": "environments.revisions.committed",
      "timestamp": "2026-01-01T00:00:00Z",
      "attributes": {
        "user_id": "smoke-test",
        "references": {"environment": "production", "revision": "v1"}
      }
    }
  }'

# 1b. workflow_dispatch — triggers .github/workflows/agenta-webhook-dispatch.yml
#     Note: all inputs must be strings (GitHub rejects objects/arrays).
echo "--- 1b. workflow_dispatch (direct) ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST \
  "https://api.github.com/repos/${REPO}/actions/workflows/agenta-webhook-dispatch.yml/dispatches" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{
    "ref": "main",
    "inputs": {
      "event_id": "00000000-0000-0000-0000-000000000001",
      "event_type": "environments.revisions.committed",
      "timestamp": "2026-01-01T00:00:00Z",
      "subscription_id": "00000000-0000-0000-0000-000000000000",
      "project_id": "00000000-0000-0000-0000-000000000000"
    }
  }'

# ============================================================================
# 2. Create Agenta webhook subscriptions
#    Run once per environment. Save the returned subscription IDs for step 3.
# ============================================================================

# 2a. repository_dispatch subscription
#     Uses payload_fields to shape the body into GitHub's expected format:
#       { "event_type": "<str>", "client_payload": { ...full event... } }
echo "--- 2a. Create repository_dispatch subscription ---"
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "$AGENTA_API_URL/webhooks/" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subscription": {
      "name": "GitHub Repository Dispatch",
      "secret": "Bearer '"$GITHUB_TOKEN"'",
      "data": {
        "auth_mode": "authorization",
        "url": "https://api.github.com/repos/'"$REPO"'/dispatches",
        "headers": {
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        "event_types": ["environments.revisions.committed"],
        "payload_fields": {
          "event_type": "$.event.event_type",
          "client_payload": "$.event"
        }
      }
    }
  }'

# 2b. workflow_dispatch subscription
#     Uses payload_fields to flatten event fields into string inputs:
#       { "ref": "main", "inputs": { "event_id": "<str>", ... } }
#     Note: $.event resolves to an object — GitHub rejects non-string inputs.
#     Cherry-pick scalar fields instead.
echo "--- 2b. Create workflow_dispatch subscription ---"
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "$AGENTA_API_URL/webhooks/" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subscription": {
      "name": "GitHub Workflow Dispatch",
      "secret": "Bearer '"$GITHUB_TOKEN"'",
      "data": {
        "auth_mode": "authorization",
        "url": "https://api.github.com/repos/'"$REPO"'/actions/workflows/agenta-webhook-dispatch.yml/dispatches",
        "headers": {
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        "event_types": ["environments.revisions.committed"],
        "payload_fields": {
          "ref": "main",
          "inputs": {
            "event_id": "$.event.event_id",
            "event_type": "$.event.event_type",
            "timestamp": "$.event.timestamp",
            "subscription_id": "$.subscription.id",
            "project_id": "$.scope.project_id"
          }
        }
      }
    }
  }'

# ============================================================================
# 3. Test subscriptions
#    Sends a webhooks.subscriptions.tested event and waits for delivery.
#    On success, sets is_valid=true so real events get dispatched.
#
#    Replace SUBSCRIPTION_ID with the id from step 2 output.
# ============================================================================

REPO_DISPATCH_SUB="${REPO_DISPATCH_SUB:?Set REPO_DISPATCH_SUB to the subscription ID from step 2a}"
WORKFLOW_DISPATCH_SUB="${WORKFLOW_DISPATCH_SUB:?Set WORKFLOW_DISPATCH_SUB to the subscription ID from step 2b}"

echo "--- 3a. Test repository_dispatch subscription ---"
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "$AGENTA_API_URL/webhooks/test/$REPO_DISPATCH_SUB" \
  -H "Authorization: ApiKey $AGENTA_API_KEY"

echo "--- 3b. Test workflow_dispatch subscription ---"
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "$AGENTA_API_URL/webhooks/test/$WORKFLOW_DISPATCH_SUB" \
  -H "Authorization: ApiKey $AGENTA_API_KEY"

# ============================================================================
# 4. Query deliveries (optional)
#    Check delivery history for a subscription.
# ============================================================================

echo "--- 4a. Deliveries for repository_dispatch subscription ---"
curl -s -X POST \
  "$AGENTA_API_URL/webhooks/deliveries/query" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"delivery": {"subscription_id": "'"$REPO_DISPATCH_SUB"'"}}' | python3 -m json.tool

echo "--- 4b. Deliveries for workflow_dispatch subscription ---"
curl -s -X POST \
  "$AGENTA_API_URL/webhooks/deliveries/query" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"delivery": {"subscription_id": "'"$WORKFLOW_DISPATCH_SUB"'"}}' | python3 -m json.tool
