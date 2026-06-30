#!/bin/sh

set -eu

# Railway SeaweedFS entrypoint. Generates the master s3.json AND the advanced IAM
# config (iam.json) from env, then starts the gateway with the IAM engine — the only
# STS path SeaweedFS authorizes (AssumeRoleWithWebIdentity against the API's JWKS).
# Mirrors the docker-compose / Helm bundled-store config. GetFederationToken is NOT
# modelled by SeaweedFS IAM (yields actionless tokens), so the OIDC provider is required.

mkdir -p /etc/seaweedfs /data

cat > /etc/seaweedfs/s3.json <<EOF
{"identities":[{"name":"agenta","credentials":[{"accessKey":"${AGENTA_STORE_ACCESS_KEY}","secretKey":"${AGENTA_STORE_SECRET_KEY}"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
EOF

cat > /etc/seaweedfs/iam.json <<EOF
{"sts":{"tokenDuration":"1h","maxSessionLength":"12h","issuer":"seaweedfs-sts","signingKey":"${AGENTA_STORE_SIGNING_KEY}"},"providers":[{"name":"agenta","type":"oidc","enabled":true,"config":{"issuer":"${AGENTA_STORE_JWT_ISSUER}","clientId":"agenta-store","jwksUri":"${AGENTA_STORE_JWT_ISSUER}/.well-known/jwks.json"}}],"policies":[{"name":"store-rw","document":{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*"],"Resource":["arn:aws:s3:::${AGENTA_STORE_BUCKET}","arn:aws:s3:::${AGENTA_STORE_BUCKET}/*"]}]}}],"roles":[{"roleName":"agenta-store","roleArn":"arn:aws:iam::role/agenta-store","attachedPolicies":["store-rw"],"trustPolicy":{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"agenta"},"Action":["sts:AssumeRoleWithWebIdentity"]}]}}]}
EOF

exec weed server -dir=/data -ip="$(hostname -i)" -volume.max=64 -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json -s3.iam.config=/etc/seaweedfs/iam.json
