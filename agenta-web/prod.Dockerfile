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
COPY .env.production .
# used in cloud
COPY sentry.* .
# Build the Next.js app for production
RUN npm run build

# Start the production server
CMD ["npm", "start"]
