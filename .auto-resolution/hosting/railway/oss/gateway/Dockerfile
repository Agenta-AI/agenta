FROM nginx:1.27-alpine

ENV PORT=8080

COPY nginx.conf /etc/nginx/nginx.conf.template

CMD ["/bin/sh", "-c", "envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
