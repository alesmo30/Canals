# Canals Console (SPEC 08). Build the static bundle with Node, serve it
# with nginx — no Node process at runtime. The browser calls the api on
# http://localhost:3000 directly (default base URL, editable in the UI),
# and :5173 is the origin the api's CORS_ORIGINS already allows.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
