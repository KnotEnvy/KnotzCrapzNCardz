# Deploying Knotz Casino

The casino is one container: a Rust binary, the built shell, the four built
games, and a SQLite file. That shape is the whole deployment story, and it is
different from the games' in one important way — **the casino has state.** Each
game's container serves files and can be thrown away and rebuilt at any moment.
This one holds everybody's wallet.

So there is exactly one thing to get right, and it is the volume.

---

## Run it in Docker

```bash
docker compose up -d --build casino     # http://localhost:8090
docker compose logs -f casino
docker compose ps casino                # is it healthy
docker compose down                     # stop it, keep the wallets
```

`docker compose down` keeps the books. `docker compose down -v` destroys them,
and that is deliberately the longer command.

### Without compose

```bash
docker build -f casino/Dockerfile -t knotz-casino .     # context is the repo root
docker run -d --name knotz-casino \
  -p 8090:8090 \
  -v knotz-floor-data:/data \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true \
  knotz-casino
```

The build context is the repository root, not `casino/` — the image builds five
apps that live in five folders. The ignore file is
`casino/Dockerfile.dockerignore` rather than a plain `.dockerignore`, because
Docker looks for that one beside the *context* root; there is a note in the file
explaining what happens without it (a 5.4 GB context and about a minute of
transfer before the first instruction runs).

### Without Docker

```bash
pnpm run casino:build
KNOTZ_SHELL_DIR=casino/dist/shell \
KNOTZ_GAMES_DIR=casino/dist/games \
KNOTZ_DB=/var/lib/knotz/floor.db \
cargo run --release --manifest-path casino/server/Cargo.toml
```

One binary, one directory of static files, one database file. There is no Node
in production and nothing to install on the host.

---

## The books

Everything worth keeping is in one SQLite file at `KNOTZ_DB`, and it is the only
path the container writes to — which is what lets the root filesystem be
read-only.

**Backing it up** while the floor is running has to go through SQLite rather than
around it. A file copy of a database in WAL mode can catch a torn write:

```bash
docker exec knotz-casino sh -c 'true'   # the image has no sqlite3 binary
# so do it from outside, with the floor stopped, or from a sidecar:
docker run --rm -v knotz-floor-data:/data -v "$PWD:/backup" \
  keinos/sqlite3 sqlite3 /data/floor.db ".backup '/backup/floor-$(date +%F).db'"
```

`.backup` is an online backup: it is safe against a running writer, and it is
the only copy method that is. Restoring is the reverse — stop the container,
replace the file, start it.

**Migrations** run at boot, from the binary, against whatever schema the file
has. A new version of the floor applied to an old database migrates it in place
and logs what it did. There is no separate migration step and no window where
the schema and the binary disagree.

---

## Play on your own network

The compose file binds `0.0.0.0:8090`, so the casino answers on this machine's
LAN address from any phone or laptop on the same network:

```bash
ipconfig getifaddr en0        # macOS
hostname -I | awk '{print $1}'  # Linux
```

Open `http://<that address>:8090` on the phone and add it to the home screen —
the shell ships a web manifest with `display: fullscreen`, so it launches
without browser chrome, which matters on a game that uses the whole viewport.

One thing to know before demoing it this way: **the wallet follows the device,
not the person.** A guest's token lives in that browser's `localStorage`, so the
phone and the laptop are two different players with two different bankrolls.
Claiming the account (a handle and a password, from the account panel) is what
joins them, and it keeps the wallet and every open table.

---

## On the actual internet

The casino is an HTTP server rather than a folder of files, so the static-host
route the games use does not apply to it. Three options, in increasing order of
effort.

### 1. Cloudflare Tunnel — keep the container, skip the DNS

```bash
cloudflared tunnel --url http://localhost:8090
```

A public HTTPS URL in about ten seconds, with no port forwarded and no inbound
firewall rule. WebSockets are proxied, which matters here: the live wallet feed
is one. Good for showing somebody; not something to leave running.

### 2. Any container host

Fly.io, Railway, Render, Cloud Run, a Kubernetes cluster — the image is an
ordinary single-port container with a health check at `/api/v1/health`. Two
things to configure wherever you put it:

- **A persistent volume at `/data`.** Without one, every deploy is a new casino
  and everybody's bankroll resets to the opening stake. On a platform whose
  filesystem is ephemeral by default this is the single mistake to avoid.
- **One instance, or Postgres.** SQLite is a file, and two instances behind a
  load balancer with their own copies of it are two casinos that disagree. The
  server's queries are all runtime-checked strings against `sqlx`, so moving to
  Postgres is a URL and a feature flag rather than a rewrite — but until then,
  scale up rather than out. For a play-money floor, one instance is a very long
  way from a bottleneck.

### 3. A VPS with a reverse proxy

nginx or Caddy in front, terminating TLS. The only requirement beyond the usual
is the WebSocket upgrade:

```nginx
location / {
    proxy_pass         http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade    $http_upgrade;   # the live wallet feed
    proxy_set_header   Connection $connection_upgrade;
    proxy_set_header   Host       $host;
    proxy_set_header   X-Forwarded-Proto $scheme;
    # A game frame holds its socket open with nothing on it between rounds.
    proxy_read_timeout 300s;
}
```

Caddy needs none of that spelled out; `reverse_proxy 127.0.0.1:8090` handles
upgrades and timeouts on its own.

Do **not** put a cache in front of `/api/v1`. The floor already sets
`Cache-Control: no-store` on every API response and `immutable` on the
content-hashed assets, which is the correct split; a proxy that ignores it and
caches a wallet will serve one player another player's balance.

---

## Verifying a deployment

```bash
curl -fsS https://your-host/api/v1/health
# {"ok":true,"version":"0.1.0","games":4,"players":…,"openTables":…}
```

Then the one that actually matters:

```bash
TOKEN=$(curl -sX POST https://your-host/api/v1/auth/guest \
  -H 'content-type: application/json' -d '{}' | jq -r .token)
curl -s https://your-host/api/v1/audit -H "authorization: Bearer $TOKEN" | jq
# {"players":1,"sessions":0,"balanced":true,"discrepancies":[]}
```

`balanced: false` means the books do not fold up, which is a bug in the floor
rather than an operational condition. It should be the check a monitor watches,
not `/health` — a floor that is up and wrong about money is worse than one that
is down.

Then open it in a browser, sit down at a table, and cash out. The receipt shows
what the cage paid; `/api/v1/me/ledger` should show exactly two rows for that
session, a `BUY_IN` and a `CASH_OUT`.

### What CSP means for a deployment

The floor sends a content-security policy with **no remote origins at all**:
every asset, font and sound the casino uses is built into it. Two consequences
worth knowing before something silently does not render:

- **No CDN.** Adding a script tag pointing at one will be blocked with nothing in
  the UI to say so. Vendor it instead.
- **`frame-ancestors 'self'`.** The games are meant to be framed by this floor
  and by nothing else. Wrapping the casino itself in someone else's frame will
  not work, and that is the intended behaviour: a game that anybody can embed in
  their own chrome is a game whose bets anybody can take.

`wasm-unsafe-eval` is in the policy for one reason — the craps dice are a Rapier
rigid-body solver compiled to WebAssembly, and instantiating it needs it.

---

## Not built yet

- **Postgres.** The queries are all portable already; what is missing is a
  second migration set and a connection-string branch in `db.rs`.
- **Rate limiting.** `POST /auth/guest` will hand out a wallet to anybody who
  asks, as often as they ask. Behind a tunnel or on a private network that is
  fine; on the open internet it wants a limiter at the proxy.
- **A real-money trust boundary.** See the note in `casino/README.md` — today the
  client is the authority on the outcome of a round, which is the right trade for
  play money and the wrong one for anything else.
