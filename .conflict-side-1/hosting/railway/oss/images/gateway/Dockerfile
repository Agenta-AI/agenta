# Prebuilt gateway wrapper image for Railway preview environments (issue #5650).
#
# Byte-faithful to hosting/railway/oss/gateway/Dockerfile (the source that
# `railway up gateway` builds today via deploy-gateway.sh); nginx.conf beside
# this file is a verbatim copy of hosting/railway/oss/gateway/nginx.conf
# (Railway private-DNS resolver [fd12::10] with variable-based proxy_pass so
# upstream redeploys re-resolve).
# Deliberate divergences from the deploy-time content: none — only these header
# comments were added. CI runs images/verify-wrappers.sh and fails on any drift.
#
# Runtime contract: expose the nginx listen port via the PORT env var
# (default 8080; the template sets PORT=8080 and the service domain targets it).
FROM nginx:1.27-alpine

ENV PORT=8080

COPY nginx.conf /etc/nginx/nginx.conf.template

CMD ["/bin/sh", "-c", "envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
