# Deploying Knotz Three Card Poker

The game is entirely client-side — the engine, the shuffle, the exact figures,
the trainer and the saved session all run in the browser, and nothing needs a
server except something to hand over the files. So `pnpm run build` produces a
folder of static files (`out/`), and everything below is a different way of
serving that folder.

There is no database, no API and no secrets. That is what makes all of this
short.

---

## Run it in Docker

```bash
cd TableGames/three-card-poker
docker compose up -d --build
```

Then open <http://localhost:8083>.

Craps takes 8080, Dragon's Shrine 8081 and blackjack 8082, so every table can
run at once from the repository root's compose file.

```bash
docker compose logs -f     # watch it
docker compose ps          # is it healthy
docker compose down        # stop it
```

The image is a two-stage build: Node compiles the game, then everything except
the output is thrown away and the result is copied into `nginx:alpine`. The
shipped image contains no Node and no installed packages — just nginx, the
built game, and the 54-card PNG deck it deals from.

That deck is about 2 MB and is the largest thing in the image. It is served
with a one-year immutable cache, so a browser fetches each card once and never
asks again; the second round of a session touches the network for nothing.

The build stage needs network access, because `next/font/google` downloads
Inter and Oswald at build time and self-hosts them in the output. That is what
stops the running game from calling out to Google, but it does mean an offline
machine cannot build the image.

---

## Play on your phone, on your own network

The container listens on every interface, so any device on your network can
reach it. On this machine that address is:

**<http://192.168.4.34:8083>**

(If that changes, `ipconfig` will tell you the new one. It is worth giving this
machine a DHCP reservation in your router so it stops moving.)

On the phone, open that address in Safari or Chrome, then **Share → Add to Home
Screen**. It installs as *Three Card*, with its own icon, and opens without the
browser's address bar because the manifest asks for `standalone`.

**Turn the phone sideways.** Three seats across a table is a wide, shallow
shape: in landscape the felt switches to a shallower layout that puts each
seat's spots in a row and drops the printed paytables, and everything stays
reachable. Held upright, the game says so rather than showing a squeezed table.

If the phone cannot reach it, Windows Firewall is the usual reason: allow
Docker, or open TCP 8083 for private networks.

Two things worth knowing about this setup:

- **Your saved session lives in the browser it was played in.** The bankroll on
  your phone and the one on your desktop are separate, because there is no
  server holding them. Clearing the site's data clears the session.
- **It only works while this machine is on**, and only on this network.

---

## Get it on the actual internet

Running the container at home and exposing it publicly means forwarding a port
on your router, keeping a dynamic DNS name pointed at a home IP that changes,
and terminating TLS yourself. It is doable, but it puts a listening service on
your home connection, and many ISPs block inbound 80/443 anyway.

Since the game is static files with no backend, there are much better options.
In rough order of how little work they are:

### 1. A static host — simplest, free, HTTPS included

```bash
pnpm run build       # produces out/

npx vercel deploy --prod out          # Vercel
npx netlify deploy --prod --dir out   # Netlify
npx wrangler pages deploy out         # Cloudflare Pages
```

GitHub Pages works too — push `out/` to a `gh-pages` branch. If you serve the
game from a subpath rather than a domain root, set `basePath` in
`next.config.ts` to match, or the asset URLs will not resolve.

**Deploying to Vercel from the repository** is the better version of this,
because every push to `main` then redeploys on its own. The one setting that
matters: this game is not at the repository root, so set **Root Directory** to
`TableGames/three-card-poker` when importing the project. Vercel reads
`vercel.json` from there.

`vercel.json` carries only the three security headers, so the hosted deploy
matches what nginx sends. It deliberately does *not* repeat the cache policy or
the manifest MIME type — Vercel already serves `/_next/static` as immutable and
knows `.webmanifest`.

### 2. Cloudflare Tunnel — keep the container, skip the port forwarding

If you want *this container* reachable from outside, a tunnel is the right way.
It dials out to Cloudflare, so nothing is forwarded, your home IP is never
published, and TLS is handled for you. Create a tunnel in the Cloudflare Zero
Trust dashboard and point it at `http://three-card-poker:80`.

### 3. A small VPS — the closest thing to running it yourself

```bash
docker build -t knotz-three-card-poker .
docker save knotz-three-card-poker | ssh you@your-server 'docker load'
```

Put a reverse proxy in front for TLS. Caddy is the least fuss, because it gets
and renews the certificate on its own:

```caddy
threecard.example.com {
    reverse_proxy three-card-poker:80
}
```

The nginx config in this folder is the *origin* server and deliberately speaks
plain HTTP on port 80 — TLS belongs at the proxy in front, not here.

---

## What the nginx config is doing

Three things in `nginx.conf` are load-bearing, and all three are easy to undo by
accident. Each is commented in place, but in short:

- **Split caching.** Files under `/_next/static` carry a content hash in their
  filename and are cached for a year as `immutable`; the HTML that names those
  files is `no-cache`. Cache the HTML and a deploy leaves browsers asking for
  chunks that no longer exist.
- **`.webmanifest`'s MIME type**, which nginx does not know natively. Served as
  `text/plain`, iOS quietly declines to install the game to the home screen.
- **The repeated security headers.** nginx's `add_header` does not accumulate:
  the moment a `location` sets one, every `add_header` above it stops applying
  there. The duplication is deliberate — removing it silently strips the
  headers.

The image also pre-gzips its output at build time and serves that with
`gzip_static`, so nginx never recompresses the same bundle on every request.
Measured inside the built image: the JavaScript, CSS and HTML together are
**864 KB, and 272 KB gzipped**, across 18 pre-compressed files. The card deck is
deliberately not in that figure — a PNG is already compressed, so `gzip_types`
omits `image/png` and the 54 cards are served as-is.

The whole served folder is **3.7 MB**: 2.0 MB of card art and 1.7 MB of game.
The finished image is **65.7 MB**, almost all of which is the
`nginx:1.29-alpine` base.

---

## Verifying a deployment

```bash
curl -I http://localhost:8083/                      # 200, Cache-Control: no-cache
curl -I http://localhost:8083/manifest.webmanifest  # application/manifest+json
curl -I http://localhost:8083/cards/14_of_spades.png # immutable, max-age=31536000
curl -I http://localhost:8083/nope                  # 404, not 200
curl    http://localhost:8083/healthz               # ok
```

All five were checked against this image. The container's own healthcheck hits
`/healthz`; `docker compose ps` reports `(healthy)` once it passes.

---

## Not built yet

- **Offline play.** There is no service worker, so the installed app still needs
  the network to load. Adding one would make it genuinely offline — worth
  doing, but note a service worker only registers over HTTPS or on localhost, so
  it would work on a hosted deployment and not on a plain-HTTP LAN address.
- **Portrait layout.** Landscape is the supported orientation on a phone; see
  above.
