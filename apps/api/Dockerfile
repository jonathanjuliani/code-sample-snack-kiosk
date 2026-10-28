FROM node:22-bookworm-slim
RUN npm install -g pnpm@11.1.3
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @kiosk/api...

COPY packages/shared packages/shared
COPY apps/api apps/api

ENV NODE_ENV=production DB_PATH=/data/kiosk.db
EXPOSE 3000
CMD ["node", "apps/api/src/server.ts"]
