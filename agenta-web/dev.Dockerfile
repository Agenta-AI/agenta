FROM node:20.18-slim

WORKDIR /app

# Copy only package.json and lock files first to leverage Docker layer caching
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./

# Install dependencies based on the available lock file
RUN \
    if [ -f yarn.lock ]; then yarn install; \
    elif [ -f package-lock.json ]; then npm ci; \
    elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm && pnpm install; \
    else yarn install; \
    fi

# Copy the rest of the application code
COPY . .

RUN npx next telemetry disable

# Expose the necessary port
EXPOSE 3000

# Start Next.js in development mode
CMD \
    if [ -f yarn.lock ]; then yarn dev; \
    elif [ -f package-lock.json ]; then npm run dev; \
    elif [ -f pnpm-lock.yaml ]; then pnpm dev; \
    else yarn dev; \
    fi
