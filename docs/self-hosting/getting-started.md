# Getting started: from install to the first emailed bug report

This walks through a new self-hosted Pinwren the way you will use it: install the server, create the admin
account, set up email, create a project, add the widget to your site, report a bug and watch it arrive in the
inbox, the bell and your email. It takes about fifteen minutes. Everything after step 1 happens in the browser.

## 1. Install

You need a server with Docker and the Compose plugin (v2.24 or later), and a hostname for Pinwren such as
`feedback.example.com`.

```bash
git clone https://github.com/Krithik-m-codes/pinwren.git && cd pinwren
cp docker/.env.example docker/.env
```

Fill in the three required values in `docker/.env`:

| Variable            | What to put                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `PINWREN_URL`       | The address people and the widget will use, e.g. `https://feedback.example.com` |
| `PINWREN_SECRET`    | `openssl rand -base64 48`                                                       |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24`                                                          |

Every other line in `docker/.env.example` is optional and commented out. Whatever you add to `docker/.env`
reaches the app, so SMTP or S3 settings can live there too, but you don't need them: email is set up in the
dashboard in step 3.

```bash
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
curl http://127.0.0.1:3000/api/health   # {"ok":true,"version":"…"}
```

Put a TLS reverse proxy in front (Caddy, nginx or Traefik) that forwards to `127.0.0.1:3000` and allows request
bodies of 48 MB: see [reverse-proxy.md](reverse-proxy.md).

> **Keep the server private until step 2 is done.** The first account created on a new server becomes its
> administrator. The compose file only listens on `127.0.0.1`, so nobody reaches it before your proxy does; if
> you expose it another way, create your account first.

## 2. Create the admin account

Open `PINWREN_URL`. A new server sends you to **Create the admin account**: enter your name, email and a
password (8 characters or more). This account is the **instance admin**: it can change email (SMTP), security
and licence settings, and it owns the first workspace. There is no setup token to look for in the logs.

Then name your **workspace** and create the **first project** — usually one project per website:

- **Website domain**: the site that will load the widget, e.g. `www.example.com`. You can add more later.
- **What is this site for?**
  - **Public website**: visitors report bugs, but reports stay private to your team (visitors don't see other
    people's pins and can't resolve anything).
  - **Staging or client review**: reviewers see each other's pins and replies on the page.

Both choices can be changed later under the project's **Privacy & data** tab.

Want more admins? Add their emails to `PINWREN_ADMIN_EMAILS` in `docker/.env` and restart. Sign-up is closed
to strangers after the first account; everyone else is added from **Settings › Users** (step 7).

## 3. Set up email

Open **Settings › Email** and fill in your SMTP server:

| Field    | Example                          |
| -------- | -------------------------------- |
| Host     | `smtp.postmarkapp.com`           |
| Port     | `587` (STARTTLS) or `465` (TLS)  |
| Security | STARTTLS for 587, TLS for 465    |
| User     | the SMTP user or API key name    |
| Password | the SMTP password or API key     |
| From     | `Pinwren <feedback@example.com>` |

Click **Send test email** and check your inbox. Provider-specific settings (SES, Postmark, Mailgun, Gmail
app passwords) and troubleshooting are in [email.md](email.md).

Environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM` in
`docker/.env`) still work and win over the dashboard: a field set that way is shown locked.

## 4. Add the widget to your site

Open your project (**Projects** in the sidebar) on the **Install** tab. It has the snippet for each way your
site may be built, all prefilled with the project key and `PINWREN_URL`:

- **HTML**: a `<script>` tag before `</body>`.
- **Next.js**: a `<Script>` in your root layout.
- **Tag Manager**: a Custom HTML tag on All Pages.
- **npm**: `npm install @pinwren/widget`, then `init({ projectKey, endpoint })` in the browser.
- **React**: `npm install @pinwren/react`, then `<Pinwren projectKey=… endpoint=… />` near the root.

Deploy your site and open it. The badge on the Install tab turns from **Waiting for your site** to
**Connected** within a few seconds.

Not connecting?

- **Allowed sites**: the widget only loads on the domains listed there. When it refuses a site, the card says
  so — "Blocked a request from https://www.example.com, 2 min ago" — with an **Allow** button. A warning shows
  while the list is empty.
- **Verify from your terminal**: the tab shows a ready-to-paste `npx @pinwren/cli doctor --url … --key … --origin …`
  command that checks the server, `widget.js` and the project's settings for your site, and says what to fix.
- If you opened the dashboard on another address than `PINWREN_URL`, the tab says so: snippets always use
  `PINWREN_URL`, so make sure it is the public address.

## 5. Report a bug

On your site, click the feedback button in the corner, choose **Report a bug**, mark up the screenshot if you
like, add your email (as a visitor would) and send it.

## 6. See it arrive

- **Inbox**: the report is at the top of the inbox with its screenshot, page, browser and console errors.
- **Bell**: every member who follows new reports gets an in-app notification.
- **Email**: the team gets a "New bug report" email with the screenshot, page, browser, priority and a link
  straight to the item. Who gets it is set per project under **Settings › Notifications › General** (all
  members, chosen members, and extra addresses).
- **Reporter**: because you left an email in the widget, you also get a "we received your report" email.
  Which emails reporters get (received, status changes, priority, assignment) is under **Settings ›
  Notifications › Reporter**, and the master switch is on the project's **Widget** tab ("Email the reporter").

A **Get started** checklist on the inbox ticks these steps off from the server's real state — admin account,
email set up, a test email sent, widget connected, first report received, a teammate added — and disappears
when they are all done (or when you hide it).

## 7. Add your team

**Settings › Users**:

- **Add user** creates the account directly (name, email, password, role); tell them their password.
- **Invite** sends an email invitation instead.

Roles: **Admin** (everything, including projects, users, integrations and settings), **Editor** (view, edit,
assign and bulk-update reports, create manual reports; no deleting and no settings) and **Viewer** (read only).
Everyone manages their own profile, avatar, password and notification preferences.

## Next steps

- Connect Slack, Discord, Microsoft Teams, Telegram or ntfy under **Settings › Integrations**, and GitHub, GitLab,
  Linear or Jira in a project's **Issue trackers** tab.
- Back up the `pinwren-db` and `pinwren-data` volumes: [backups](../../apps/www/content/docs/self-hosting/backups.mdx).
- Export a project (JSON + files) or erase everything one reporter sent from the project's **Privacy & data** tab.
