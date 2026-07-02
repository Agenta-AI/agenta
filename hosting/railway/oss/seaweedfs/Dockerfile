# Wrapper Dockerfile for Railway deployment.
# Bakes the IAM-aware entrypoint so the bundled store serves S3 STS via the OIDC
# engine (AssumeRoleWithWebIdentity). Pin a 4.37-era image: IAM regressed in other releases.

FROM chrislusf/seaweedfs:4.37

COPY entrypoint.sh /usr/local/bin/railway-seaweedfs-entrypoint.sh
RUN chmod +x /usr/local/bin/railway-seaweedfs-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/railway-seaweedfs-entrypoint.sh"]
