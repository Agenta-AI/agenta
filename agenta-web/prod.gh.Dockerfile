# Stage 1: Build Stage
FROM node:20.18-slim AS builder

ARG NEXT_PUBLIC_AGENTA_API_URL="http://localhost"
ARG NEXT_PUBLIC_FF="oss"
ARG NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED="true"
ARG NEXT_PUBLIC_POSTHOG_API_KEY="phc_hmVSxIjTW1REBHXgj2aw4HW9X6CXb6FzerBgP9XenC7"

ENV NEXT_PUBLIC_AGENTA_API_URL=$NEXT_PUBLIC_AGENTA_API_URL
ENV NEXT_PUBLIC_FF=$NEXT_PUBLIC_FF
ENV NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED=$NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED
ENV NEXT_PUBLIC_POSTHOG_API_KEY=$NEXT_PUBLIC_POSTHOG_API_KEY

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci
# Copy only necessary files
COPY src ./src
COPY public ./public
COPY next.config.js .
COPY tsconfig.json .
COPY postcss.config.js .
COPY tailwind.config.ts .
COPY sentry.* .
# Build the Next.js app for production
RUN npm run build

# Stage 2: Production Stage
FROM node:20.18-slim AS prod

WORKDIR /app

# Copy only the necessary files from the build stage
COPY --from=builder /app/package.json /app/package-lock.json* /app
COPY --from=builder /app/.next /app/.next
COPY --from=builder /app/public /app/public
COPY --from=builder /app/next.config.js /app/tsconfig.json /app/postcss.config.js /app/tailwind.config.ts app/sentry.* /app/

# Install only production dependencies
RUN npm ci --omit=dev

# Expose the necessary port
EXPOSE 3000

# Start the production server
CMD ["npm", "start"]
