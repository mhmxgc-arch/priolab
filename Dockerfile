# Priolab v2 (sites-secure/) as a Node server on APP-01.
#
# The source is written for Sites (Cloudflare Workers + D1). deploy/v2/adapt.mjs
# turns it into a plain Next.js standalone server during the build -- SQLite
# file instead of D1, Traefik's X-Real-Ip instead of cf-connecting-ip -- and
# fails the build if anything it relies on has changed. The repository itself
# is never modified, so the same source still deploys to Sites.

FROM node:24-alpine AS build
WORKDIR /src/sites-secure
RUN corepack enable
COPY sites-secure/ ./
COPY dist/jszip.min.js /src/dist/jszip.min.js
COPY deploy/v2/ /src/deploy/v2/
RUN node /src/deploy/v2/adapt.mjs .
# No lockfile in the repository: dependencies resolve from package.json within
# the release-age policy in pnpm-workspace.yaml.
RUN pnpm install --no-frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM node:24-alpine
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PRIOLAB_DB_PATH=/data/priolab.sqlite \
    PRIOLAB_MIGRATIONS=/app/drizzle
WORKDIR /app
COPY --from=build /src/sites-secure/.next/standalone ./
COPY --from=build /src/sites-secure/.next/static ./.next/static
COPY --from=build /src/sites-secure/public ./public
COPY --from=build /src/sites-secure/drizzle ./drizzle
USER 10004:10004
EXPOSE 3000
CMD ["node", "server.js"]
