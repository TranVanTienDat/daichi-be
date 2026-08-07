# ==========================================
# Stage 1: deps — cài toàn bộ dependencies (kể cả dev, để build được)
# ==========================================
FROM node:22-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libvips-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/
COPY package.json yarn.lock ./

RUN yarn config set network-timeout 600000 -g \
    && yarn install --frozen-lockfile

# ==========================================
# Stage 2: builder — build Strapi (admin panel + TS)
# ==========================================
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=3072"
ENV PATH=/opt/node_modules/.bin:$PATH

WORKDIR /opt/
COPY --from=deps /opt/node_modules ./node_modules

WORKDIR /opt/app
COPY . .

# Build plugin tele trước (vì dist/ bị gitignore, server không có sẵn)
# NODE_ENV=development để yarn cài cả devDependencies (có @strapi/sdk-plugin chứa strapi-plugin binary)
RUN cd src/plugins/tele \
    && NODE_ENV=development yarn install --frozen-lockfile \
    && ./node_modules/.bin/strapi-plugin build

# Sau đó mới build Strapi
RUN yarn build

# ==========================================
# Stage 3: prod-deps — chỉ dependencies cho production (không dev)
# ==========================================
FROM node:22-slim AS prod-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/
COPY package.json yarn.lock ./

RUN yarn config set network-timeout 600000 -g \
    && yarn install --frozen-lockfile --production

# ==========================================
FROM node:22-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=384"
ENV PATH=/opt/node_modules/.bin:$PATH
ENV PORT=3000
ENV HOST=0.0.0.0

WORKDIR /opt/
COPY --from=prod-deps /opt/node_modules ./node_modules

WORKDIR /opt/app
COPY --from=builder /opt/app/dist ./dist
COPY --from=builder /opt/app/public ./public
COPY --from=builder /opt/app/src ./src
COPY --from=builder /opt/app/package.json ./package.json
COPY --from=builder /opt/app/tsconfig.json ./tsconfig.json
COPY --from=builder /opt/app/scripts ./scripts

RUN chown -R node:node /opt/app /opt/node_modules
USER node

EXPOSE 3000
CMD ["yarn", "start"]