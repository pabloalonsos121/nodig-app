# ---- builder: install deps (with toolchain in case better-sqlite3 needs it) ----
FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# ---- runtime: slim image, no build tools ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Copy the installed deps (with the compiled better-sqlite3 binary) and the app.
COPY --from=builder /app ./
EXPOSE 3000
CMD ["node", "server/index.js"]
