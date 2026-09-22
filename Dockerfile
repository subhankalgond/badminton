# Runs the registration site as a normal, long lived Node process, with the
# database and the payment screenshots kept on a disk you mount.
#
# Mount that disk at /data when you deploy, because the site cannot store
# registrations without a writable, persistent folder. Hosts whose filesystem
# is read only or wiped on every restart (Vercel, and free tiers without a
# volume) cannot run this image correctly.
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# express and multer are the only runtime dependencies. The webfonts are
# already committed under public/fonts, so the build tools are not needed here.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Where the database and the screenshots live. Point these at your volume if
# it is mounted somewhere else, for example /var/data on Render.
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    UPLOAD_DIR=/data/uploads

RUN mkdir -p /data/uploads && chown -R node:node /data
USER node

EXPOSE 3000

CMD ["node", "server.js"]
