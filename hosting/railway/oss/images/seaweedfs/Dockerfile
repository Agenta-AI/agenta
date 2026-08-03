# Prebuilt SeaweedFS wrapper image for Railway preview environments (issue #5650).
#
# Byte-faithful to the Dockerfile render_seaweedfs_wrapper() in
# hosting/railway/oss/scripts/deploy-from-images.sh generates per PR today;
# entrypoint.sh beside this file is a verbatim copy of
# hosting/railway/oss/seaweedfs/entrypoint.sh (renders s3.json + the advanced
# IAM config from env, then starts `weed server` with the IAM engine —
# failure-history item 17: without it the STS AssumeRoleWithWebIdentity path
# the store mounts need does not exist).
# Base pinned to 4.37: its advanced IAM regressed in other releases (same pin
# as SEAWEEDFS_IMAGE in deploy-from-images.sh).
# Deliberate divergences from the deploy-time content: none — only these header
# comments were added. CI runs images/verify-wrappers.sh and fails on any drift.
#
# Runtime contract (env the entrypoint requires): AGENTA_STORE_ACCESS_KEY,
# AGENTA_STORE_SECRET_KEY, AGENTA_STORE_SIGNING_KEY, AGENTA_STORE_JWT_ISSUER,
# AGENTA_STORE_BUCKET (all set by configure.sh in the template environment).
FROM chrislusf/seaweedfs:4.37

COPY entrypoint.sh /usr/local/bin/railway-seaweedfs-entrypoint.sh
RUN chmod +x /usr/local/bin/railway-seaweedfs-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/railway-seaweedfs-entrypoint.sh"]
