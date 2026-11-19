# Imagen de la API. El build compila y luego `pnpm deploy` deja solo dependencias de producción.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @commerce-core/api build \
  && pnpm --filter @commerce-core/api deploy --prod /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
