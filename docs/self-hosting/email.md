# Email on a self-hosted Pinwren

Pinwren sends every email through an SMTP server you choose: new-report emails to your team, assignments, replies,
mentions, invitations, password resets, digests and the emails reporters get from the widget. Until SMTP is set up,
nothing fails: each email is **skipped and logged**, the in-app bell keeps working, and you can send the skipped
emails later.

## Set it up in the dashboard (recommended)

The first account created on a fresh instance is the instance admin, so right after signing up:

1. Open **Settings › Email**. A yellow banner at the top of every page links there until email works.
2. Pick your provider under **Provider** to fill in the host and port (nothing is saved yet), or type them.
3. Enter the username, password and **From address** (`noreply@example.com` or `Pinwren <noreply@example.com>`).
4. Click **Send test email**. It connects, signs in and sends one message **with the values in the form, before you
   save them**, and shows the server's answer (for example `Authentication failed: 535 …`).
5. Click **Save changes**.

The password is write-only: it is stored encrypted with `PINWREN_SECRET` and never shown again.

### Ports and TLS

| Setting                             | Use it when                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Port **587**, **Use TLS** off       | Most providers. The connection starts unencrypted and upgrades with STARTTLS.                                         |
| **Require STARTTLS** on             | With port 587 or 25: refuse to send if the server doesn't upgrade (protects the password from a downgrade).           |
| Port **465**, **Use TLS** on        | Providers that want TLS from the first byte (e.g. Resend's `smtp.resend.com:465`).                                    |
| **Allow a self-signed certificate** | Only for a mail server on your own network whose certificate can't be verified. Never for a provider on the internet. |

The form warns about the usual mix-ups (465 without TLS, 587 with TLS).

### Common providers

| Provider          | Host                                 | Port | Username          | Notes                                                      |
| ----------------- | ------------------------------------ | ---- | ----------------- | ---------------------------------------------------------- |
| Gmail / Workspace | `smtp.gmail.com`                     | 587  | your address      | Needs an **app password**, not your normal password        |
| Microsoft 365     | `smtp.office365.com`                 | 587  | your address      | SMTP AUTH must be enabled for the mailbox                  |
| Amazon SES        | `email-smtp.<region>.amazonaws.com`  | 587  | SES SMTP username | SES SMTP credentials, not IAM keys; verify the From domain |
| Postmark          | `smtp.postmarkapp.com`               | 587  | Server API token  | Password is the same token                                 |
| Mailgun           | `smtp.mailgun.org` (EU: `smtp.eu.…`) | 587  | domain SMTP login |                                                            |
| SendGrid          | `smtp.sendgrid.net`                  | 587  | `apikey`          | Password is an API key                                     |
| Brevo             | `smtp-relay.brevo.com`               | 587  | your Brevo login  | Password is the SMTP key                                   |
| Resend            | `smtp.resend.com`                    | 465  | `resend`          | Use TLS on; password is an API key                         |

Use a From address on a domain the provider has verified (SPF/DKIM), or mail lands in spam.

## Or with environment variables

Every field can be set by an environment variable. A variable **overrides and locks** its field: the dashboard shows
it read-only with the variable's name, and the API refuses a change (`409 SETTING_LOCKED`). Use this to keep the
credentials in your secret store.

| Variable                       | Field                                                    |
| ------------------------------ | -------------------------------------------------------- |
| `SMTP_HOST`                    | SMTP host                                                |
| `SMTP_PORT`                    | Port (default 587, or 465 when `SMTP_SECURE=true`)       |
| `SMTP_USER` / `SMTP_PASSWORD`  | Credentials                                              |
| `SMTP_SECURE`                  | `true` = TLS from the start (465)                        |
| `SMTP_REQUIRE_TLS`             | `true` = refuse servers that don't upgrade with STARTTLS |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | `false` = accept a self-signed certificate               |
| `EMAIL_FROM`                   | From address                                             |

```bash
# docker/.env
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=your-server-token
SMTP_PASSWORD=your-server-token
SMTP_REQUIRE_TLS=true
EMAIL_FROM="Acme Feedback <feedback@acme.example>"
```

Make sure the variables reach the container (the compose file's `env_file`/`environment`). Email counts as set up
once a host and a From address exist, from either source.

## Who gets which email

**Team** (members of the workspace; each person's own switches in **Settings › Notifications › My notifications**
apply, and nobody hears about their own action):

| Event              | Goes to                                                                                                              | Template         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------- |
| New report         | The project's recipients (**Notifications › General**: all members, or the chosen ones) **plus** its extra addresses | New feedback     |
| Assigned           | The newly assigned people                                                                                            | Assigned to you  |
| Status changed     | Assignees and followers; a visitor's change on an item nobody follows goes to every member with Status on            | Status changed   |
| Priority changed   | Assignees and followers                                                                                              | Priority changed |
| Reply              | Assignees, followers and earlier commenters; a visitor's reply nobody follows goes to every member with Replies on   | New reply        |
| @mention           | The mentioned member (instead of the reply email)                                                                    | Mentioned        |
| Moved to the trash | Assignees and followers                                                                                              | Feedback deleted |
| Webhook disabled   | Workspace Admins                                                                                                     | Webhook disabled |

People follow an item automatically when they report it from a signed-in session, are assigned, comment or are
@mentioned, or by clicking **Follow**.

New-report and assignment emails show the screenshot, priority, page, browser and OS, console error and failed request
counts, and whether a session replay exists. The screenshot is a signed link that works without signing in (for 180
days). Every team email has a **Manage notifications** link and a one-click `List-Unsubscribe` header that turns off
email for that project only. Extra addresses get an **Unsubscribe** link that removes them from the project.

**Reporters** (the address they left in the widget; **Notifications › Reporter**, per project, all under the **Email the
reporter** master switch):

| Email            | Default | When                                     |
| ---------------- | ------- | ---------------------------------------- |
| Report received  | on      | Right after they send it from the widget |
| Reply            | always  | Each **public** reply from the team      |
| Status changes   | on      | The team resolves, closes or reopens it  |
| Priority changes | off     | The team sets or changes the priority    |
| Assignment       | off     | Someone on the team takes it on          |

Reporter emails link to the conversation on the page (a signed link that opens the widget on their report, valid 30
days) and carry a one-click unsubscribe for the whole workspace.

**Account emails** (password reset, email verification, email change) go to the person, whatever the workspace.

## Digests and pausing

Under **My notifications**, each person picks **Instantly**, **Hourly digest** or **Daily digest**, or **Pause all
email**. Digest users get no instant team emails; once an hour (or once a day) one email lists what they haven't read
yet, per workspace. Paused users get no notification emails at all. The bell is never affected.

## Troubleshooting with the delivery log

**Settings › Email › Recent deliveries** (instance admins) lists the last 50 emails of the past 30 days:

- **Sent**: the SMTP server accepted it. If it never arrived, check the recipient's spam folder and your domain's
  SPF/DKIM records.
- **Skipped — SMTP is not configured**: sent while email wasn't set up. Once it is, **Send skipped emails** queues
  them all (last 30 days); **Send again** sends one right away.
- **Skipped — unsubscribed**: the reporter unsubscribed; it won't be sent again.
- **Failed**: the server refused it on every attempt (one try plus four retries with backoff over about 15 minutes).
  The reason starts with a category:

  | Category               | Usually means                                                                    |
  | ---------------------- | -------------------------------------------------------------------------------- |
  | Authentication failed  | Wrong username or password; Gmail needs an app password                          |
  | Connection failed      | Wrong host or port, or the firewall blocks outgoing SMTP (many clouds block 25)  |
  | Host not found         | Typo in the host, or no DNS from the container                                   |
  | TLS problem            | Port/TLS mismatch, or a certificate the server can't verify                      |
  | Rejected by the server | The From address or domain isn't allowed to send, or the recipient doesn't exist |
  | Temporarily refused    | Rate limits or greylisting; retried automatically                                |

The log keeps the full message for the resend and is pruned after 30 days by the nightly retention job.
