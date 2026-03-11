FROM ghcr.io/agenta-ai/agenta-web:latest

# Next.js must bind to 0.0.0.0 for external access
ENV HOSTNAME="0.0.0.0"
ENV AGENTA_LICENSE=oss

CMD ["node", "/app/oss/server.js"]
