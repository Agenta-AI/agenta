FROM redis:8.2.1

COPY entrypoint.sh /usr/local/bin/railway-redis-entrypoint.sh
RUN chmod +x /usr/local/bin/railway-redis-entrypoint.sh

USER root

ENTRYPOINT ["/usr/local/bin/railway-redis-entrypoint.sh"]
CMD ["redis-server"]
