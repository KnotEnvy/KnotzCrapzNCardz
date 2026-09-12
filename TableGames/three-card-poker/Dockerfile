# syntax=docker/dockerfile:1

# ------------------------------------------------------------------------
# Knotz Three Card Poker
#
# The game is entirely client-side, so this builds it to static files and
# then throws the toolchain away: the shipped image is nginx plus a folder
# of HTML, JS and fonts. No Node runs in production, which is why the final
# image is tens of megabytes rather than hundreds and has no installed
# packages in it to need patching. The same shape as every other table here.
# ------------------------------------------------------------------------

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app

# Corepack reads the `packageManager` field in package.json and fetches exactly
# that pnpm, so the image cannot quietly build with a different one than a
# developer has.
RUN corepack enable

# Dependencies are their own layer, so editing game code does not reinstall
# them. `--frozen-lockfile` builds exactly the lockfile and fails rather than
# updating it.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# NB: this step needs network access. `next/font/google` fetches Inter and
# Oswald at build time and self-hosts them in the output -- that is what keeps
# the running game from calling out to Google, but it means an offline build
# machine will fail here.
#
# The 54-card PNG deck in public/cards is copied through as-is. It is already
# compressed, so the gzip pass below deliberately skips images.
RUN pnpm run build

# Precompress everything worth compressing so nginx can serve the .gz directly
# instead of compressing the same bundle on every request. `-k` keeps the
# original for clients that cannot take gzip.
RUN find out -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' \
         -o -name '*.svg' -o -name '*.txt' -o -name '*.webmanifest' \) \
      -size +1k -exec gzip -9 -k {} \;

# ---- serve ----
FROM nginx:1.29-alpine AS serve

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
