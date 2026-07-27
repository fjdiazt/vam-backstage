FROM node:24-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:unpack

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libasound2 \
        libatspi2.0-0 \
        libcups2 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnotify4 \
        libnss3 \
        libsecret-1-0 \
        libx11-xcb1 \
        libxcb-dri3-0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libxss1 \
        libxtst6 \
        xdg-utils \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 backstage \
    && mkdir -p /data /vam \
    && chown -R backstage:backstage /data /vam

COPY --from=build /app/dist/linux-unpacked /opt/vam-backstage
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER backstage
ENV VAM_SERVE=42069 \
    VAM_DIR=/vam \
    VAM_USER_DATA=/data \
    VAM_STORAGE_MODE=manual

EXPOSE 42069 42070

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
