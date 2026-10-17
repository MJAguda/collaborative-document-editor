# Build stage: install everything, build the client, then drop dev dependencies.
FROM node:22.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage: Node runs the TypeScript server directly (type stripping), no compile step.
FROM node:22.21.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/app.db NODE_OPTIONS=--max-old-space-size=128
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
EXPOSE 3000
CMD ["node", "server/index.ts"]
