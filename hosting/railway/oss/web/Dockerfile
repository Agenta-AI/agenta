FROM ghcr.io/agenta-ai/agenta-web:latest

# Next.js must bind to 0.0.0.0 for external access
ENV HOSTNAME="0.0.0.0"
ENV AGENTA_LICENSE=oss

CMD ["sh", "-c", "/web/entrypoint.sh node /web/oss/server.js"]
