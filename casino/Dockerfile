# syntax=docker/dockerfile:1

# ------------------------------------------------------------------------
# Knotz Casino — the whole floor, in one image.
#
# The four games each ship their own nginx container, and those still exist:
# a game is developed, play-tested and deployed on its own long before the
# casino is involved. This image is the *casino*, and it is one process rather
# than five because the floor is one origin.
#
# That is the decision worth understanding before changing anything here. The
# shell frames each game, and money crosses the boundary as `postMessage`. Put
# the shell and the games on different origins and every one of those messages
# becomes a cross-origin exchange, the API needs CORS, and the frame loses
# access to its own storage under a browser's third-party rules. Serve them all
# from the floor's own binary and none of that exists: the frame is same-origin,
# `frame-ancestors 'self'` is exactly true, and there is one port to open.
#
# Three stages. Node builds the static files and is thrown away; Rust builds the
# binary and is thrown away; what ships is a slim Debian with one executable,
# one folder of HTML, and curl for the health check.
# ------------------------------------------------------------------------

# ---- 1. the shell and the four games, as static files ----
FROM node:24-bookworm-slim AS web
WORKDIR /src

# Corepack reads each app's `packageManager` field and fetches exactly that
# pnpm, so this image cannot quietly build with a different one than a
# developer has.
RUN corepack enable

# The whole repository, because this stage builds five apps that live in five
# folders. `Dockerfile.dockerignore` beside this file — not `.dockerignore`, see
# the note in it — keeps `node_modules`, `out`, `.next`, the Rust target
# directory and the git history out of the context.
COPY . .

# NB: this step needs network access, twice over. pnpm fetches each app's
# dependencies, and `next/font/google` fetches the faces at build time to
# self-host them in the output — which is what keeps the running casino from
# calling out to Google, and what makes an offline build machine fail here.
#
# The build script is what sets `CASINO_BASE_PATH` per game. A static export
# bakes its base path into every asset URL it emits, so a game built for `/`
# and served from `/games/craps/` renders a blank page; see the script.
RUN node casino/tools/build-casino.mjs

# ---- 2. the floor ----
FROM rust:1-bookworm AS floor
WORKDIR /src

# The manifest and the lockfile first, with a stub main, so the dependency
# build is its own layer and editing the server does not rebuild axum, tokio and
# sqlx from scratch.
#
# `--locked` rather than a fallback: the lockfile is committed, and a build that
# quietly resolves a different dependency tree than the one that was tested is
# not a build worth shipping. If this fails, the lockfile is missing or stale and
# that is the thing to fix.
COPY casino/server/Cargo.toml casino/server/Cargo.lock ./
RUN mkdir -p src && \
    echo 'fn main() {}' > src/main.rs && \
    echo '' > src/lib.rs && \
    cargo build --release --locked

COPY casino/server/src ./src
COPY casino/server/migrations ./migrations

# `touch` is load-bearing: cargo decides what to rebuild from mtimes, and the
# stub above has already produced a binary with a newer one than the sources
# just copied in. Without this the real `main.rs` is not rebuilt and the image
# ships the stub, which starts, exits zero, and looks like a crash loop with no
# error message.
RUN touch src/main.rs src/lib.rs && cargo build --release --locked

# ---- 3. what ships ----
FROM debian:bookworm-slim AS serve

# curl for the health check, ca-certificates so a future outbound call works at
# all. Nothing else: the binary is one file and carries its own SQLite.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# A named user rather than root, and one that owns the data directory. The
# casino's only writable path is its database.
RUN useradd --system --create-home --uid 10001 floor && \
    mkdir -p /data && chown floor:floor /data

COPY --from=floor  /src/target/release/knotz-floor /usr/local/bin/knotz-floor
COPY --from=web    /src/casino/dist/shell          /srv/shell
COPY --from=web    /src/casino/dist/games          /srv/games

ENV KNOTZ_SHELL_DIR=/srv/shell \
    KNOTZ_GAMES_DIR=/srv/games \
    KNOTZ_DB=/data/floor.db \
    PORT=8090 \
    RUST_LOG=knotz_floor=info,tower_http=warn,sqlx=warn

USER floor
VOLUME ["/data"]
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8090/api/v1/health || exit 1

# No shell form, so the binary is PID 1 and receives SIGTERM directly — which
# is what its graceful shutdown is waiting for. A cash-out interrupted halfway
# is the one request worth draining for.
CMD ["knotz-floor"]
