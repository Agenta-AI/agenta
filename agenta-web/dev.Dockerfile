FROM node:22-alpine3.18 AS base

WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
    if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm install; \
    elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm && pnpm install; \
    else yarn install; \
    fi

# Copy only the necessary files for development
COPY src ./src
COPY public ./public
COPY next.config.js .
COPY tsconfig.json .
COPY postcss.config.js .
COPY tailwind.config.ts .
COPY .env .
COPY sentry.* .

# Stage 2: Development Stage
FROM node:22-alpine3.18 AS dev

WORKDIR /app

# Copy dependencies and application files from the base stage
COPY --from=base /app /app

# Install development dependencies
RUN \
    if [ -f yarn.lock ]; then yarn install; \
    elif [ -f package-lock.json ]; then npm install; \
    elif [ -f pnpm-lock.yaml ]; then pnpm install; \
    else yarn install; \
    fi

# Expose the necessary ports
EXPOSE 3000

# Start Next.js in development mode based on the preferred package manager
CMD \
    if [ -f yarn.lock ]; then yarn dev; \
    elif [ -f package-lock.json ]; then npm run dev; \
    elif [ -f pnpm-lock.yaml ]; then pnpm dev; \
    else yarn dev; \
    fi
