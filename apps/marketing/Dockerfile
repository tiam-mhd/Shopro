FROM node:22-bookworm-slim AS build

WORKDIR /workspace

COPY apps/marketing/package.json apps/marketing/package.json
COPY apps/marketing/server.mjs apps/marketing/server.mjs
COPY apps/marketing/scripts apps/marketing/scripts
COPY apps/marketing/src apps/marketing/src

RUN npm run build --prefix apps/marketing

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV PUBLIC_URL=http://localhost:8080

COPY --from=build --chown=node:node /workspace/apps/marketing/server.mjs ./server.mjs
COPY --from=build --chown=node:node /workspace/apps/marketing/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
