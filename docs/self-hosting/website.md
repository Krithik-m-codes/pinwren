# Host the website and docs

<!-- Mirrors apps/www/content/docs/self-hosting/website.mdx (the website page); keep them in step. -->

Run your own copy of this site (landing page, docs and the live demo in apps/www) on Vercel or in Docker behind your reverse proxy.

The site you are reading is `apps/www` in the repository: a Next.js app with the landing page, these docs, the
changelog and the live demo on `/demo`. It needs **no database** — the demo keeps its sandboxes in memory and
resets them every 10 minutes. You only need this page if you want to publish your own copy, for example a fork
or an internal mirror; running Pinwren itself is covered in [Deploy on your server](https://pinwren.xride-labs.in/docs/self-hosting/deploy).

Before you build, set your domain and links in
[`apps/www/src/lib/site.ts`](https://github.com/Krithik-m-codes/pinwren/blob/main/apps/www/src/lib/site.ts)
(`SITE_URL`, the GitHub repository, the Docker image name). Canonical links, the sitemap and social cards are
built from it.

The build reads the rest of the repository: the environment variable reference comes from
`packages/api/src/env.ts`, the changelog from `CHANGELOG.md`, and the widget the demo loads from
`packages/widget/dist` (built automatically when it is missing). Build from a full checkout, not from the
`apps/www` folder alone.

### Vercel

1. **Import** the repository in Vercel (**Add New › Project**).
2. **Root Directory:** `apps/www`. Leave **Include files outside the root directory in the Build Step** on — the
   build reads the rest of the repository.
3. **Framework preset:** Next.js. Keep the default build command (`pnpm build`, which runs
   `node scripts/prepare.mjs && next build`) and output settings.
4. **Install command:** `pnpm install --frozen-lockfile`. Vercel runs it at the repository root, so the whole
   workspace is installed.
5. **Environment variables:**
   - `ENABLE_EXPERIMENTAL_COREPACK=1`, so Vercel uses the pnpm version pinned in the root `package.json`
     (`packageManager`).
   - `DEMO_TRUST_PLATFORM_IP_HEADER=x-vercel-forwarded-for`, so the demo's rate limits see each visitor's
     address instead of putting everyone in one bucket.
6. **Deploy**, then add your domain under **Settings › Domains**.

> **The demo on Vercel.** The demo API runs as Next.js route handlers, which Vercel turns into serverless functions. Two things follow:
> Vercel refuses request bodies over 4.5 MB, so a demo bug report with a very large screenshot fails there
> (the demo itself accepts up to 12 MB); and sandboxes live in one function instance's memory, so a visitor may
> occasionally land on an instance that doesn't have their demo feedback. Neither affects the landing page or
> the docs. For a demo that behaves exactly like a real server, use Docker.

### Docker

The repository has a ready Dockerfile that builds the widget and the site and runs Next.js's standalone server
on port 3000. Build it from the repository root:

```bash
git clone https://github.com/Krithik-m-codes/pinwren.git && cd pinwren
docker build -f apps/www/Dockerfile -t pinwren-www .
docker run -d --name pinwren-www --restart unless-stopped -p 127.0.0.1:3200:3000 \
  -e PINWREN_TRUST_PROXY=1 pinwren-www
```

`PINWREN_TRUST_PROXY=1` tells the demo there is one reverse proxy in front of it, so its rate limits use the
visitor's address from `X-Forwarded-For`. Leave it unset if the container is reachable directly.

Put it behind the same reverse proxy as Pinwren, with its own name. With nginx and certbot:

```nginx title="/etc/nginx/conf.d/pinwren-www.conf"
server {
    listen 80;
    server_name pinwren.example.com;

    # The demo accepts bug reports with screenshots up to 12 MB.
    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pinwren.example.com
```

On Portainer, build the image on the server with the commands above (or push it to a registry) and run it as a
stack with the same port and environment variable. To update the site, `git pull`, rebuild and recreate the
container.

## Demo settings

The demo needs no configuration. These optional variables tune it:

| Variable                        | Default     | Effect                                                                                                                                |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_RESET_MINUTES`            | `10`        | How long a visitor's demo feedback is kept.                                                                                           |
| `DEMO_MAX_SANDBOXES`            | `2000`      | Live sandboxes in memory; the least recently used is dropped to make room.                                                            |
| `DEMO_MAX_SANDBOX_BYTES`        | `6291456`   | Bytes stored per sandbox (6 MiB).                                                                                                     |
| `DEMO_MAX_TOTAL_BYTES`          | `201326592` | Bytes across all sandboxes (192 MiB).                                                                                                 |
| `DEMO_TRUST_PLATFORM_IP_HEADER` | unset       | A header your platform sets itself with the visitor's address (Vercel: `x-vercel-forwarded-for`).                                     |
| `PINWREN_TRUST_PROXY`           | unset       | Reverse proxies in front of the site, as for the [app](https://pinwren.xride-labs.in/docs/self-hosting/environment#client-addresses). |
