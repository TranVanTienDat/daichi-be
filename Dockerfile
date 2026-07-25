# ─────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────
FROM node:20-alpine AS builder

# Install build dependencies for native modules (sharp, etc.)
RUN apk add --no-cache libc6-compat vips-dev python3 make g++

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./

# Use npm install (not ci) to avoid lock file platform mismatch
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build Strapi admin panel
RUN npm run build

# ─────────────────────────────────────────
# Stage 2: Production
# ─────────────────────────────────────────
FROM node:20-alpine AS runner

# Runtime dependencies for sharp image processing
RUN apk add --no-cache libc6-compat vips

WORKDIR /app

ENV NODE_ENV=production

# Copy only what's needed to run
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/config ./config
COPY --from=builder /app/src ./src
COPY --from=builder /app/favicon.png ./

# Create upload directory
RUN mkdir -p /app/public/uploads

EXPOSE 1337

CMD ["npm", "run", "start"]
