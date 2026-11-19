FROM ghcr.io/agenta-ai/agenta-web-mobile:latest

# Next.js must bind to 0.0.0.0 for external access
ENV HOSTNAME="0.0.0.0"
ENV AGENTA_LICENSE=oss

CMD ["sh", "-c", "/app/entrypoint.sh node /app/mobile/server.js"]
