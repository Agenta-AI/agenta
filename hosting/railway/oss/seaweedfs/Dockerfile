# Wrapper Dockerfile for Railway deployment.
# Bakes the IAM-aware entrypoint so the bundled store serves S3 STS via the OIDC
# engine (AssumeRoleWithWebIdentity). Pin the image: IAM regressed in other releases, and
# anything below 4.42 keeps listing a pre-versioning object after its delete marker is
# written, so a deleted file reappears in a geesefs mount and cannot be read.

FROM chrislusf/seaweedfs:4.47

COPY entrypoint.sh /usr/local/bin/railway-seaweedfs-entrypoint.sh
RUN chmod +x /usr/local/bin/railway-seaweedfs-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/railway-seaweedfs-entrypoint.sh"]
