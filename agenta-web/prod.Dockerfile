# Stage 1: Build Stage
FROM node:20.18-slim AS builder

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
COPY .env.production .
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
COPY --from=builder /app/next.config.js /app/tsconfig.json /app/postcss.config.js /app/tailwind.config.ts /app/.env.production /app/sentry.* /app/

# Install only production dependencies
RUN npm ci --omit=dev

# Expose the necessary port
EXPOSE 3000

# Start the production server
CMD ["npm", "start"]
