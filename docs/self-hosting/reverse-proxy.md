# Reverse proxy in front of Pinwren

Pinwren listens on plain HTTP (port 3000 in the Docker image). In production put a TLS-terminating reverse proxy
in front of it. Whatever proxy you use, it has to do five things:

1. **Terminate TLS** and forward `X-Forwarded-For` (appending to it), `X-Forwarded-Proto` and `X-Forwarded-Host`.
   Set `PINWREN_TRUST_PROXY` to the number of proxies in front of Pinwren (`1` for one proxy, `2` for a CDN plus
   your proxy) so Pinwren believes them, and `PINWREN_ENFORCE_HTTPS=true` to refuse plain HTTP. See
   [Client addresses](#client-addresses).
2. **Allow request bodies of at least 48 MB** (the limit Pinwren itself accepts). A bug report can carry a screenshot, three 5 MB attachments and a
   10 MB session replay, all base64 in one JSON body. Pinwren checks every limit itself.
3. **Not buffer the real-time stream** (`/api/stream`, Server-Sent Events) and keep it open for at least 16
   minutes: Pinwren ends each stream after 15 minutes and the browser reconnects.
4. **Compress the widget with brotli** (gzip as the fallback). Pinwren itself only gzips responses, so have the
   proxy drop `Accept-Encoding` towards Pinwren and compress (and cache) the brotli copies itself.
5. **Keep Pinwren's cache headers.** `/widget.js` is served with `Cache-Control: public, max-age=300` (its name
   never changes); its chunks `/widget-<name>.<10-hex-hash>.js` with `public, max-age=31536000, immutable`
   (their name changes with their content). Both carry `Access-Control-Allow-Origin: *` because customer sites
   load them cross-origin. Don't override these.

Leave security headers to Pinwren: dashboard pages carry their own `Content-Security-Policy`, `X-Frame-Options`,
`Referrer-Policy`, `Cross-Origin-Opener-Policy` and `Permissions-Policy` (the widget files and `/w` are exempt).
Don't add a second CSP at the proxy; browsers enforce both.

## Client addresses

`PINWREN_TRUST_PROXY` is a hop count (`true` = 1, `false`/`0` = no proxy). Each proxy appends the address it
received the request from to the right end of `X-Forwarded-For`; Pinwren reads the header from the right and
skips one entry per trusted hop, so whatever a client wrote into it is ignored. `X-Real-IP` is never read. With no
trusted hop, forwarded headers are ignored and the socket address is used.

Every proxy in the chain must **append** to the header it received (nginx: `$proxy_add_x_forwarded_for`), not
replace it or pass a client's value through. Caddy and Traefik append only for requests from addresses they trust,
so behind a CDN list the CDN's ranges in `trusted_proxies` (Caddy) or `forwardedHeaders.trustedIPs` (Traefik).
Too low a count makes every visitor share your proxy's rate limit; too high lets clients choose their address.

## Caddy

Caddy speaks HTTPS with automatic certificates, streams responses without buffering and forwards the
`X-Forwarded-*` headers by default. Brotli needs a Caddy build with an encoder plugin (for example
`xcaddy build --with github.com/ueffel/caddy-brotli`); without it, use `encode zstd gzip`.

```caddyfile
feedback.example.com {
	# Brotli first; gzip for older clients. Already-compressed screenshots are left alone.
	encode br zstd gzip

	request_body {
		max_size 48MB
	}

	reverse_proxy pinwren:3000 {
		# Ask Pinwren for uncompressed responses; Caddy compresses them.
		header_up -Accept-Encoding
		# Server-Sent Events: write each event straight through.
		flush_interval -1
		transport http {
			read_timeout 20m
		}
	}
}
```

## nginx

Brotli needs the [`ngx_brotli`](https://github.com/google/ngx_brotli) module (packaged as `libnginx-mod-brotli`
on Debian/Ubuntu, built into the `fholzer/nginx-brotli` image).

```nginx
upstream pinwren {
    server pinwren:3000;
    keepalive 16;
}

server {
    listen 443 ssl;
    http2 on;
    server_name feedback.example.com;
    ssl_certificate     /etc/letsencrypt/live/feedback.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/feedback.example.com/privkey.pem;

    client_max_body_size 48m;

    brotli on;
    brotli_comp_level 6;
    brotli_types text/javascript application/javascript application/json text/css image/svg+xml;
    gzip on;
    gzip_types text/javascript application/javascript application/json text/css image/svg+xml;

    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    # Ask Pinwren for uncompressed responses; nginx compresses them.
    proxy_set_header Accept-Encoding "";

    # Real-time stream: no buffering, no compression, long reads.
    location = /api/stream {
        proxy_pass http://pinwren;
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        brotli off;
        proxy_read_timeout 20m;
    }

    location / {
        proxy_pass http://pinwren;
    }
}

server {
    listen 80;
    server_name feedback.example.com;
    return 308 https://$host$request_uri;
}
```

## Traefik (v3, Docker labels)

Traefik's `compress` middleware encodes brotli and gzip, and skips `text/event-stream` responses, so the
real-time stream is not buffered. Raise the body limit with the `buffering`
middleware (48 MB = `50331648` bytes).

```yaml
services:
  pinwren:
    image: ghcr.io/krithik-m-codes/pinwren:latest
    environment:
      PINWREN_URL: https://feedback.example.com
      PINWREN_TRUST_PROXY: "1"
      PINWREN_ENFORCE_HTTPS: "true"
    labels:
      - traefik.enable=true
      - traefik.http.routers.pinwren.rule=Host(`feedback.example.com`)
      - traefik.http.routers.pinwren.entrypoints=websecure
      - traefik.http.routers.pinwren.tls.certresolver=letsencrypt
      - traefik.http.routers.pinwren.middlewares=pinwren-identity,pinwren-compress,pinwren-body
      # An empty value removes the header: Pinwren answers uncompressed and Traefik compresses.
      - traefik.http.middlewares.pinwren-identity.headers.customrequestheaders.Accept-Encoding=
      - traefik.http.middlewares.pinwren-compress.compress.encodings=br,gzip
      - traefik.http.middlewares.pinwren-body.buffering.maxRequestBodyBytes=50331648
      - traefik.http.services.pinwren.loadbalancer.server.port=3000
```

For streams longer than Traefik's default idle timeout, set
`--entrypoints.websecure.transport.respondingTimeouts.readTimeout=20m` (and `idleTimeout`) on the Traefik
command line.

## Checking it

```bash
# Brotli and the long cache on a hashed chunk (take a name from /widget.js or the image's public folder):
curl -sI -H 'Accept-Encoding: br' https://feedback.example.com/widget.js | grep -iE 'content-encoding|cache-control'
# The stream stays open and prints a ping every 25 s (needs a session cookie):
curl -N -H "Cookie: $COOKIE" https://feedback.example.com/api/stream
```

`pinwren doctor --url https://feedback.example.com` (from `@pinwren/cli`) checks the health endpoint, the widget
script and a project's configuration from the outside.
