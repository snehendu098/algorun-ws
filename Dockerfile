# Use official Bun image
FROM oven/bun:1 AS base

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY bun.lockb package.json ./
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

# Expose your app port (adjust if needed)
EXPOSE 3001

# Start the Hono app
CMD ["bun", "src/index.ts"]
