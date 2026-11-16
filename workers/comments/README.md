# korappath-comments

This Cloudflare Worker receives every form on korappath.com. No Formspree, no third-party service, no GitHub writes.

| Form | Page | Endpoint |
|---|---|---|
| Chapter comments | every chapter | `/comments` |
| Photo / story | homepage | `/submit/story` |
| Write a story | `write.html` | `/submit/write` |
| Tree photo | family tree pages | `/submit/tree-photo` |
| Access request | homepage popup | `/submit/access` |

- Everything lands in the inbox at **`https://dash.korappath.com`**, which only Raju can open (Cloudflare Access).
- Each new item also emails Raju from `no-reply@korappath.com`.
- Comments stay hidden until approved. Once approved, they appear on the chapter straight away.
- Uploaded photos are kept privately in Workers KV until the submission is deleted.

## Setup

Done on 2026-11-16: login, D1 database, comments table, first deploy to `comments.korappath.com`, Access app, and the `ACCESS_AUD`, `ADMIN_EMAILS` and `IP_SALT` secrets. The photo store (KV namespace `korappath-uploads`) is created and listed in `wrangler.jsonc`.

Completed on 2026-11-16 as well:
- Email Routing on korappath.com, with alerts from `no-reply@korappath.com`.
- The `NOTIFY_TO` secret and the submissions table.
- The dashboard at `dash.korappath.com`: Access app "Dashboard", allowing only Raju.
- A second Access app, "Korappath public forms", that bypasses `dash.korappath.com/comments` and `dash.korappath.com/submit/*` for everyone.
- Every page switched off Formspree. The old `comments.korappath.com` address was retired.

To redeploy after changing the Worker, run `wrangler deploy` from this folder.

## Checking it works

1. Send a test through each form: a chapter comment, the homepage photo/story form with a small photo, `write.html`, an access request, and a tree photo.
2. Each one should show a thank-you page. `write.html` comes back with "Sent to Raju".
3. You should get one email per item.
4. Each item should appear in the inbox.
5. Delete the tests.

## How it's protected

- `/admin` is behind Cloudflare Access, and the Worker also checks the Access token itself: signature, AUD, issuer, expiry, and the `ADMIN_EMAILS` allow-list. If anything is missing, nobody gets in.
- Forms are only accepted from korappath.com pages. Every form has a hidden honeypot field, and there are hourly limits per visitor: 5 comments and 10 submissions.
- Photos must be images of 20 MB or less. They are only viewable inside the inbox.

## Local testing

```bash
printf 'ALLOWED_ORIGINS=http://localhost:8123\nDEV_ADMIN_BYPASS=1\nNOTIFY_TO=test@example.com\n' > .dev.vars
```

```bash
wrangler d1 execute korappath-comments --local --file=schema.sql
```

```bash
wrangler dev --local --port 8787 --local-upstream localhost:8787
```

- Serve the site on port 8123 and open a chapter with `?commentsApi=http://localhost:8787`.
- To test the other forms, point their `action` at `http://localhost:8787/...`, or post to them with `curl -F`.
- Local emails are not sent. Wrangler writes them to `.wrangler/tmp/email/`.
- `DEV_ADMIN_BYPASS` only works when the request host is `localhost`. `.dev.vars` is git-ignored and never deployed.
