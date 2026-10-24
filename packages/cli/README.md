# @pinwren/cli

Command line for [Pinwren](https://pinwren.xride-labs.in): add the feedback widget to a site, check that an install
works, and see open feedback per project. One self-contained file, no dependencies, Node.js ≥ 20. MIT.

```sh
npx @pinwren/cli --help
# or install it: npm install -g @pinwren/cli  →  pinwren …
```

## `pinwren init`

Asks for your instance URL and the project key (`pk_…`, from **Settings › Install**), detects Next.js, Vite or
plain HTML from `package.json`, and prints the snippet. With `--write` it inserts it: before `</body>` of
`index.html`, or as `<Script>` in `app/layout.tsx` for Next.js (once — it won't add it twice).

```sh
pinwren init --url https://feedback.example.com --key pk_123… --write
pinwren init --framework html --file public/index.html --write
```

## `pinwren doctor`

Checks a running instance: the server answers (and which version), `widget.js` is served, and — with a key —
the widget config loads for your site's origin. Exits 1 if anything fails.

```sh
pinwren doctor --url https://feedback.example.com --key pk_123… --origin https://www.example.com
✓ server: reachable, Pinwren 0.1.0
✓ widget.js: served
✗ widget config: https://www.example.com is not on the project's allowed origins (Settings › Install)
```

`--json` prints `{ ok, checks: [{ name, ok, detail }] }` for scripts and CI.

## `pinwren status`

Lists projects and their open items, using an API token (**Settings › API tokens**, `feedback:read`).

```sh
PINWREN_TOKEN=pwt_… pinwren status --url https://feedback.example.com
Signed in as Ann (admin)
  Marketing site    12 open
  Web app            3 open
```

## Environment

`PINWREN_URL`, `PINWREN_KEY` and `PINWREN_TOKEN` fill `--url`, `--key` and `--token`.

## License

MIT © Pinwren contributors
