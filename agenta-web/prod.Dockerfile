FROM node:20.18-slim

# Set the working directory
WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN npx next telemetry disable
RUN npm run build

# Expose the necessary port
EXPOSE 3000

# Start the production server
CMD ["npm", "start"]
