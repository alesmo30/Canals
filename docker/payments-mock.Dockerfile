# SPEC 03: multi-stage build for the standalone payments-mock service. Its
# own package.json/package-lock.json (Decisions: "its own package") — the
# app's dependency tree never sees Fastify. Build context is the repo root
# (docker-compose.yml: `context: ., dockerfile: docker/payments-mock.Dockerfile`),
# so every path below is `payments-mock/...`.
FROM node:22-alpine AS build
WORKDIR /app
COPY payments-mock/package*.json ./
RUN npm ci
COPY payments-mock/. .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
EXPOSE 4000
CMD ["node", "dist/main.js"]
