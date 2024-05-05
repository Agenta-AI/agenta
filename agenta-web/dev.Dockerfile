FROM node:18-alpine

WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
    # echo "Standalone: $NEXT_PUBLIC_STANDALONE"; \
    # if [[ ! $NEXT_PUBLIC_STANDALONE == "true" ]]; then  \
    if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm i; \
    elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i; \
    # Allow install without lockfile, so example works even without Node.js installed locally
    else echo "Warning: Lockfile not found. It is recommended to commit lockfiles to version control." && yarn install; \
    fi
# else echo "NEXT_PUBLIC_STANDALONE is set, skipping install"; \
# fi

COPY src ./src
COPY public ./public
COPY next.config.js .
COPY tsconfig.json .
COPY postcss.config.js .
COPY tailwind.config.ts .
COPY .env .
RUN if [ -f .env.local ]; then cp .env.local .; fi
# RUN if [ -f tailwind.config.ts ]; then cp tailwind.config.ts .; fi
# # used in cloud
COPY sentry.* .
# Next.js collects completely anonymous telemetry data about general usage. Learn more here: https://nextjs.org/telemetry
# Uncomment the following line to disable telemetry at run time
# ENV NEXT_TELEMETRY_DISABLED 1

# Note: Don't expose ports here, Compose will handle that for us

# Start Next.js in development mode based on the preferred package manager
CMD \
    # echo "Standalone: $NEXT_PUBLIC_STANDALONE"; \
    # if [[ ! $NEXT_PUBLIC_STANDALONE == "true" ]]; then  \
    if [ -f yarn.lock ]; then yarn dev; \
    elif [ -f package-lock.json ]; then npm run dev; \
    elif [ -f pnpm-lock.yaml ]; then pnpm dev; \
    else yarn dev; \
    fi
# else echo "NEXT_PUBLIC_STANDALONE is set, skipping run"; \
# fi

