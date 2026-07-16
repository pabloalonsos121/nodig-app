# Pure-JS dependencies + Node's built-in node:sqlite means no native build
# toolchain is needed — a single slim stage is enough.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server/index.js"]
