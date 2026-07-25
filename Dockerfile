FROM node:22-slim

# Cài dependencies cần cho sharp/libvips
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libvips-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

ARG NODE_ENV=development
ENV NODE_ENV=${NODE_ENV}

WORKDIR /opt/
COPY package.json yarn.lock ./

RUN yarn config set network-timeout 600000 -g \
    && yarn install --frozen-lockfile

ENV PATH=/opt/node_modules/.bin:$PATH

WORKDIR /opt/app
COPY . .
RUN chown -R node:node /opt/app
USER node

EXPOSE 1337
CMD ["yarn", "run", "develop"]