# infrastructure.md §3, "One image, two commands": one build, two
# entrypoints (api/worker) selected by compose's `command:`, not by this
# file. R0.1: the lint script (in the build stage) fails on error, so a
# failing build stops the image here, not at deploy time.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# package.json (not package-lock.json — nothing here runs `npm ci` again)
# is the one addition beyond infrastructure.md's skeleton: `migrate` and
# `seed` (docker-compose.yml, this step) run via `npm run <script>`, which
# needs it to resolve script names, same as `api`/`worker` need nothing
# more than `dist/` and `node_modules/`.
COPY --from=build /app/package.json ./package.json
# no CMD: compose decides which entrypoint runs
