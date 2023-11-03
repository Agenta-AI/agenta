FROM node:18-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy only necessary files
COPY src ./src
COPY public ./public
COPY next.config.js .
COPY tsconfig.json .
COPY postcss.config.js .
COPY .env .
# used in cloud 
RUN if [ -f sentry.client.config.ts ]; then cp sentry.client.config.ts .; fi
RUN if [ -f sentry.edge.config.ts ]; then cp sentry.edge.config.ts .; fi
RUN if [ -f sentry.server.config.ts ]; then cp sentry.server.config.ts .; fi

# Build the Next.js app for production
RUN npm run build

# Start the production server
CMD ["npm", "start"]
