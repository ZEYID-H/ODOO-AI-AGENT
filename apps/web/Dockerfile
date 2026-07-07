# Next.js frontend (apps/web) — self-contained build context (this
# directory only; it has its own package.json, prisma/, app/, etc.).
#
# Build:  docker build -t odoo-bi-web apps/web
# Run:    see docker-compose.saas.yml — needs DATABASE_URL pointed at a
#         writable volume, AUTH_SECRET, APP_ACCESS_PASSWORD, and
#         NEXT_PUBLIC_API_BASE_URL (see apps/web/.env.local.example).
#
# Runtime keeps the full node_modules (no pruned "standalone" build):
# prisma migrate deploy has to run against the mounted volume at container
# startup, and the Prisma CLI needs its own dependency tree present to do
# that — this is local full-stack dev tooling, not a size-optimized
# production image (that's explicitly out of scope for this phase).

FROM node:20-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time — this
# is what the *browser* uses, not how containers reach each other. See
# docker-compose.saas.yml for why chat/health calls resolve via the
# published host port rather than Docker's internal service DNS.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

# `prisma generate` only reads the schema file — it needs *a* DATABASE_URL
# to be set but never connects to it at build time. The real one is
# supplied at container runtime, pointed at the mounted volume.
ENV DATABASE_URL="file:./prisma/build-placeholder.db"
RUN npx prisma generate

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

RUN chmod +x ./docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
