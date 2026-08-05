# ── Reset password for old-admin@agenta.ai ───────────────────────────────────
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/reset-password" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_identities": [
      {
        "method": "email:password",
        "subject": "old-admin@agenta.ai",
        "password": "Passw0rd!"
      }
    ]
  }' -w "\nHTTP %{http_code}\n"

# ── Transfer ownership from old-admin to new-admin ───────────────────────────
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/transfer-ownership" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "users": {
      "source": {"email": "old-admin@agenta.ai"},
      "target": {"email": "new-admin@agenta.ai"}
    }
  }' -w "\nHTTP %{http_code}\n"

# ── Delete old-admin account by email ─────────────────────────────────────────
curl -s -X DELETE "$AGENTA_API_URL/admin/simple/accounts/" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": {"old-admin": {"user": {"email": "old-admin@agenta.ai"}}},
    "confirm": "delete"
  }' -w "\nHTTP %{http_code}\n"

# ── Create a single account ─────────────────────────────────────────────────
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": {
      "alice": {
        "user": {"email": "alice@test.agenta.ai"},
        "options": {
          "create_api_keys": true,
          "return_api_keys": true,
          "seed_defaults": true
        }
      }
    }
  }' | jq .

# ── Create multiple accounts in one call ────────────────────────────────────
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": {
      "bob":   {"user": {"email": "bob@test.agenta.ai"}},
      "carol": {"user": {"email": "carol@test.agenta.ai"}}
    }
  }' | jq 'keys'

# ── Dry-run create (nothing persisted) ──────────────────────────────────────
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "options": {"dry_run": true},
    "accounts": {
      "dry": {"user": {"email": "dry@test.agenta.ai"}}
    }
  }' | jq '.accounts.dry.user.email'

# ── Delete account by email ──────────────────────────────────────────────────
curl -s -X DELETE "$AGENTA_API_URL/admin/simple/accounts/" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": {"alice": {"user": {"email": "alice@test.agenta.ai"}}},
    "confirm": "delete"
  }' -w "\nHTTP %{http_code}\n"

# ── Create standalone user (no org/workspace) ────────────────────────────────
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/users/" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user": {"email": "standalone@test.agenta.ai"}}' | jq '.accounts[0].users'

# ── Add an identity to an existing user ──────────────────────────────────────
# Replace USER_ID with the id returned from the create call above.
USER_ID="<USER_ID>"
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/users/identities/" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"user_ref\": {\"id\": \"$USER_ID\"},
    \"user_identity\": {
      \"method\": \"email:password\",
      \"subject\": \"alias@test.agenta.ai\",
      \"password\": \"TestPass1!\",
      \"verified\": true
    }
  }" | jq '.accounts[0].user_identities'

# ── Create a standalone organization ─────────────────────────────────────────
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/organizations/" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "organization": {"name": "My Org"},
    "owner": {"email": "bob@test.agenta.ai"}
  }' | jq '.accounts[0].organizations'

# ── Create a workspace inside an org ─────────────────────────────────────────
# Replace ORG_ID with the id returned above.
ORG_ID="<ORG_ID>"
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/workspaces/" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"workspace\": {
      \"name\": \"My Workspace\",
      \"organization_ref\": {\"id\": \"$ORG_ID\"}
    }
  }" | jq '.accounts[0].workspaces'

# ── Reset password for an email:password identity ────────────────────────────
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/reset-password" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_identities": [
      {
        "method": "email:password",
        "subject": "bob@test.agenta.ai",
        "password": "NewValidPass1!"
      }
    ]
  }' -w "\nHTTP %{http_code}\n"

# ── Transfer organization ownership ──────────────────────────────────────────
# Replace ORG_ID with the org to transfer.
ORG_ID="<ORG_ID>"
curl -s -X POST "$AGENTA_API_URL/admin/simple/accounts/transfer-ownership" \
  -H "Authorization: Access $AGENTA_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"organizations\": {\"org\": {\"id\": \"$ORG_ID\"}},
    \"users\": {
      \"source\": {\"email\": \"bob@test.agenta.ai\"},
      \"target\": {\"email\": \"carol@test.agenta.ai\"}
    }
  }" -w "\nHTTP %{http_code}\n"
