FROM node:22-bookworm-slim
WORKDIR /app
# python3 + modal SDK for the Modal provider bridge (Modal has no Node SDK)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && pip3 install --break-system-packages --no-cache-dir modal \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY server.js sandbox-provider.js run-lock.js session-persist.js provider-modal.js daytona_snapshot.js modal_bridge.py ./
CMD ["node", "server.js"]
