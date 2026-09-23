# Runs the registration site as a normal, long lived Node process.
#
# The site keeps its registrations and payment screenshots in PostgreSQL and
# writes nothing to disk, so this image runs anywhere: a host with a persistent
# disk, a free instance whose filesystem is wiped on every restart, or your own
# machine. The database is the only thing that has to be reachable.
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# express, multer and pg are the only runtime dependencies. The webfonts are
# already committed under public/fonts, so the build tools are not needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The database connection line, the organizer password and the session key are
# read from the environment. .dockerignore keeps the local .env file out of the
# image, so nothing secret is baked in here.
ENV HOST=0.0.0.0 \
    PORT=3000

USER node

EXPOSE 3000

CMD ["node", "server.js"]
