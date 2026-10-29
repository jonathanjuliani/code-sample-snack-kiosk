FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@11.1.3
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @kiosk/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @kiosk/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
