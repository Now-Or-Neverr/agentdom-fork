# Agentdom: API server + built web app in one container.
FROM node:24-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

# data/ (SQLite database + uploads) lives on a persistent volume mounted at /app/data.
# An optional seed/ snapshot is imported once into the volume (marker: data/.seeded).
EXPOSE 8790
CMD ["sh", "-c", "if [ -f /app/seed/agentdom.db ] && [ ! -f /app/data/.seeded ]; then echo '[seed] importing data snapshot into the volume'; rm -f /app/data/agentdom.db /app/data/agentdom.db-wal /app/data/agentdom.db-shm; cp -a /app/seed/. /app/data/ && date -u > /app/data/.seeded; fi; exec npm start"]
