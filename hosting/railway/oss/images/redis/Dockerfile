# Prebuilt redis wrapper image for Railway preview environments (issue #5650).
#
# Byte-faithful to the Dockerfile render_redis_wrapper() in
# hosting/railway/oss/scripts/deploy-from-images.sh generates per PR today;
# entrypoint.sh beside this file is a verbatim copy of
# hosting/railway/oss/redis/entrypoint.sh (chowns /data to the redis UID before
# delegating to the official docker-entrypoint.sh — failure-history item 14:
# Railway volumes mount root-owned and plain redis:8 crash-loops on MISCONF).
# Deliberate divergences from the deploy-time content:
#   - the FROM tag is hard-pinned to redis:8 instead of resolved at render time
#     from hosting/docker-compose/oss/docker-compose.gh.yml (same value today).
# Only that pin and these header comments differ. CI runs
# images/verify-wrappers.sh, which re-resolves the compose baseline and fails
# the build if this pin (or anything else) drifts.
FROM redis:8

COPY entrypoint.sh /usr/local/bin/railway-redis-entrypoint.sh
RUN chmod +x /usr/local/bin/railway-redis-entrypoint.sh

USER root

ENTRYPOINT ["/usr/local/bin/railway-redis-entrypoint.sh"]
CMD ["redis-server"]
