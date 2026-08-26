FROM node:22-alpine

# better-sqlite3 собирается из исходников — нужны сборочные инструменты
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js rollup.js schema.sql dashboard.html ./

# Сюда монтируется том с базой
VOLUME /data
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/api/health || exit 1

CMD ["node", "server.js"]
