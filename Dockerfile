FROM node:24.18.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
ARG VITE_DATA_GATEWAY_URL=/
ENV VITE_DATA_GATEWAY_URL=$VITE_DATA_GATEWAY_URL
RUN npm run api:generate && npm run build

FROM node:24.18.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS runtime-deps
WORKDIR /app
COPY deploy/runtime/package.json deploy/runtime/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:70a2c12a0d76018b54d7bd01c5e3677632eeed9f890ba318d6db55fc54cf3baa AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --from=runtime-deps --chown=65532:65532 /app/package.json ./package.json
COPY --from=runtime-deps --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/api ./api
COPY --from=build /app/dist ./dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8787/api/v1/health').then(async r=>{const h=await r.json();if(r.status!==200||h.ready!==true)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["server/index.mjs"]
