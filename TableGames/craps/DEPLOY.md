# Deploying Knotz Craps

The game is entirely client-side — the engine, the physics, the strategies and
the saved session all run in the browser, and nothing needs a server except
something to hand over the files. So `npm run build` produces a folder of static
files (`out/`), and everything below is a different way of serving that folder.

There is no database, no API and no secrets. That is what makes all of this
short.

---

## Run it in Docker

```bash
cd TableGames/craps
docker compose up -d --build
```

Then open <http://localhost:8080>.

```bash
docker compose logs -f     # watch it
docker compose ps          # is it healthy
docker compose down        # stop it
```

The image is a two-stage build: Node compiles the game, then everything except
the output is thrown away and the result is copied into `nginx:alpine`. The
shipped image is about **69 MB** and contains no Node and no npm packages — just
nginx and the built game.

The build stage needs network access, because `next/font/google` downloads Inter
and Oswald at build time and self-hosts them in the output. That is what stops
the running game from calling out to Google, but it does mean an offline
machine cannot build the image.

---

## Play on your iPhone, on your own network

The container is already listening on every interface, so any device on your
network can reach it. On this machine that address is:

**<http://192.168.4.34:8080>**

(If that changes, `ipconfig` will tell you the new one. It is worth giving this
machine a DHCP reservation in your router so it stops moving.)

On the phone, open that address in Safari, then **Share → Add to Home Screen**.
It installs as *Craps*, with its own icon, and opens without Safari's address
bar because the manifest asks for `standalone`.

**Turn the phone sideways.** A craps layout is a wide object — the pass line,
the box numbers and the propositions sit beside each other, and in portrait
every bet box is too small to hit accurately. Landscape fits an iPhone exactly,
with nothing cut off. Held upright, the game says so rather than showing you a
squeezed table.

If the phone cannot reach it, Windows Firewall is the usual reason: allow
Docker, or open TCP 8080 for private networks.

Two things worth knowing about this setup:

- **Your saved session lives in the browser it was played in.** The bankroll on
  your phone and the one on your desktop are separate, because there is no
  server holding them. Clearing Safari's data for the site clears the session.
- **It only works while this machine is on**, and only on this network.

---

## Get it on the actual internet

This is the part your original plan is thin on, so it is worth being direct:
running the container at home and then exposing it publicly means forwarding a
port on your router, keeping a dynamic DNS name pointed at a home IP that
changes, and terminating TLS yourself. It is doable, but it puts a listening
service on your home connection, and many ISPs block inbound 80/443 anyway.

Since the game is static files with no backend, there are much better options.
In rough order of how little work they are:

### 1. A static host — simplest, free, HTTPS included

Nothing to run, nothing to keep patched, and a real HTTPS domain (which is also
what makes the home-screen install feel like an app anywhere, not just at home).

```bash
npm run build       # produces out/

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
`TableGames/craps` when importing the project. Vercel reads `vercel.json` from
there.

`vercel.json` carries only the three security headers, so the hosted deploy
matches what nginx sends. It deliberately does *not* repeat the cache policy or
the manifest MIME type — Vercel already serves `/_next/static` as immutable and
knows `.webmanifest` — and unlike nginx, its headers do not need restating per
path.

### 2. Cloudflare Tunnel — keep the container, skip the port forwarding

If you specifically want *this container* reachable from outside, a tunnel is
the right way. It dials out to Cloudflare, so nothing is forwarded, your home IP
is never published, and TLS is handled for you.

Create a tunnel in the Cloudflare Zero Trust dashboard, point it at
`http://craps:80`, then:

```bash
CLOUDFLARE_TUNNEL_TOKEN=<your token> \
  docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
```

`docker-compose.tunnel.yml` sits next to this file and adds only the tunnel
container.

### 3. A small VPS — the closest thing to the original plan

The image is portable, so any host that runs Docker will run it:

```bash
docker build -t knotz-craps .
docker save knotz-craps | ssh you@your-server 'docker load'
```

Put a reverse proxy in front for TLS. Caddy is the least fuss, because it gets
and renews the certificate on its own:

```caddy
craps.example.com {
    reverse_proxy craps:80
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
`gzip_static`, which takes the main bundle from **4.0 MB to 1.4 MB** without
nginx recompressing it on every request.

---

## Verifying a deployment

```bash
curl -I http://localhost:8080/                      # 200, Cache-Control: no-cache
curl -I http://localhost:8080/manifest.webmanifest  # application/manifest+json
curl -I http://localhost:8080/nope                  # 404, not 200
curl    http://localhost:8080/healthz               # ok
curl -I -H 'Accept-Encoding: gzip' \
     http://localhost:8080/_next/static/chunks/*.js # Content-Encoding: gzip
```

The container's own healthcheck hits `/healthz`; `docker compose ps` reports
`(healthy)` once it passes.

---

## Not built yet

- **Offline play.** There is no service worker, so the installed app still needs
  the network to load. Adding one would make it genuinely offline — worth doing,
  but note a service worker only registers over HTTPS or on localhost, so it
  would work on a hosted deployment and not on a plain-HTTP LAN address.
- **Portrait layout.** Landscape is the supported orientation on a phone; see
  above.
