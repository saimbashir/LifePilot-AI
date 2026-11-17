# Private single-owner Docker deployment. Requires working registry and npm packages.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8787 DB_PATH=/srv/lifepilot/lifepilot.sqlite
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund
COPY backend/src ./backend/src
COPY --from=build /app/dist ./dist
RUN mkdir -p /srv/lifepilot && chown -R node:node /srv/lifepilot
USER node
EXPOSE 8787
CMD ["node","backend/src/server.mjs"]
