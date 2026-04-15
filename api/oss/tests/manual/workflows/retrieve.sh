# Inferred key — development
curl -s -X POST "$AGENTA_API_URL/api/preview/applications/revisions/retrieve" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"application_ref": {"slug": "srgserg"}, "environment_ref": {"slug": "development"}}' | jq '.count == 1'

# Inferred key — production
curl -s -X POST "$AGENTA_API_URL/api/preview/applications/revisions/retrieve" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"application_ref": {"slug": "srgserg"}, "environment_ref": {"slug": "production"}}' | jq '.count == 1'

# Explicit key — development
curl -s -X POST "$AGENTA_API_URL/api/preview/applications/revisions/retrieve" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"environment_ref": {"slug": "development"}, "key": "srgserg.revision"}' | jq '.count == 1'

# Explicit key — production
curl -s -X POST "$AGENTA_API_URL/api/preview/applications/revisions/retrieve" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"environment_ref": {"slug": "production"}, "key": "srgserg.revision"}' | jq '.count == 1'

# By app slug only
curl -s -X POST "$AGENTA_API_URL/api/preview/applications/revisions/retrieve" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"application_ref": {"slug": "srgserg"}}' | jq '.count == 1'

# By app + variant slug
curl -s -X POST "$AGENTA_API_URL/api/preview/applications/revisions/retrieve" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"application_ref": {"slug": "srgserg"}, "application_variant_ref": {"slug": "srgserg.defaults"}}' | jq '.count == 1'

# By app + variant slug + explicit revision version 2
curl -s -X POST "$AGENTA_API_URL/api/preview/applications/revisions/retrieve" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"application_ref": {"slug": "srgserg"}, "application_variant_ref": {"slug": "srgserg.defaults"}, "application_revision_ref": {"version": "2"}}' | jq '.count == 1'
