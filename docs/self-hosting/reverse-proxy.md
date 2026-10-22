# Reverse proxy in front of Pinwren

Pinwren listens on plain HTTP (port 3000 in the Docker image). In production put a TLS-terminating reverse proxy
in front of it. Whatever proxy you use, it has to do five things:

1. **Terminate TLS** and forward `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`. Set
   `PINWREN_TRUST_PROXY=true` so Pinwren believes them (and `PINWREN_ENFORCE_HTTPS=true` to refuse plain HTTP).
2. **Allow request bodies of at least 32 MB.** A bug report can carry a screenshot, three 5 MB attachments and a
   10 MB session replay, all base64 in one JSON body. Pinwren checks every limit itself.
3. **Not buffer the real-time stream** (`/api/stream`, Server-Sent Events) and keep it open for at least 16
   minutes: Pinwren ends each stream after 15 minutes and the browser reconnects.
4. **Compress the widget with brotli** (gzip as the fallback). Pinwren serves `/widget.js` and its chunks
   uncompressed and leaves compression to the proxy, which can cache the compressed copies.
5. **Keep Pinwren's cache headers.** `/widget.js` is served with `Cache-Control: public, max-age=300` (its name
   never changes); its chunks `/widget-<name>.<10-hex-hash>.js` with `public, max-age=31536000, immutable`
   (their name changes with their content). Both carry `Access-Control-Allow-Origin: *` because customer sites
   load them cross-origin. Don't override these.

## Caddy

Caddy speaks HTTPS with automatic certificates, streams responses without buffering and forwards the
`X-Forwarded-*` headers by default. Brotli needs a Caddy build with an encoder plugin (for example
`xcaddy build --with github.com/ueffel/caddy-brotli`); without it, use `encode zstd gzip`.

```caddyfile
feedback.example.com {
	# Brotli first; gzip for older clients. Already-compressed screenshots are left alone.
	encode br zstd gzip

	request_body {
		max_size 32MB
	}

	reverse_proxy pinwren:3000 {
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

    client_max_body_size 32m;

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
real-time stream is not buffered. Raise the body limit with the `buffering` middleware.

```yaml
services:
  pinwren:
    image: ghcr.io/krithik-m-codes/pinwren:latest
    environment:
      PINWREN_URL: https://feedback.example.com
      PINWREN_TRUST_PROXY: "true"
      PINWREN_ENFORCE_HTTPS: "true"
    labels:
      - traefik.enable=true
      - traefik.http.routers.pinwren.rule=Host(`feedback.example.com`)
      - traefik.http.routers.pinwren.entrypoints=websecure
      - traefik.http.routers.pinwren.tls.certresolver=letsencrypt
      - traefik.http.routers.pinwren.middlewares=pinwren-compress,pinwren-body
      - traefik.http.middlewares.pinwren-compress.compress.encodings=br,gzip
      - traefik.http.middlewares.pinwren-body.buffering.maxRequestBodyBytes=33554432
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

`pinwren doctor https://feedback.example.com` (from `@pinwren/cli`) checks the health endpoint, the widget
script and a project's configuration from the outside.
