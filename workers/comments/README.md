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

To finish the move to `dash.korappath.com` with no Formspree, do these in order.

**1. Turn on Email Routing for korappath.com** (Cloudflare dashboard):

1. Open korappath.com, then **Email → Email Routing → Enable**, and accept the DNS records it adds. korappath.com has no email today, so nothing breaks.
2. Under **Destination addresses**, add `raj@13apples.com` and click the link in the verification email.
3. Under **Routing rules → Custom addresses**, create `no-reply@korappath.com` and send it to `raj@13apples.com`. Alerts come from this address.

**2. Add the alert address secret.** Type `raj@13apples.com` when asked.

```bash
wrangler secret put NOTIFY_TO
```

**3. Add the submissions table.** This is safe to re-run; existing comments are untouched.

```bash
wrangler d1 execute korappath-comments --remote --file=schema.sql
```

**4. Deploy.** This also creates `dash.korappath.com`. `comments.korappath.com` keeps working during the switch.

```bash
wrangler deploy
```

**5. Move the Access lock to the dashboard** (Zero Trust → Access → Applications):

1. Edit the existing **Korappath comments admin** app. Change the domain to `dash.korappath.com` and **clear the path**, so the whole site is locked to your email. Rename it "Korappath dashboard" if you like. Editing it keeps the same AUD tag, so the `ACCESS_AUD` secret doesn't change.
2. **Add a second application** (Self-hosted) named "Korappath public forms":
   - Domain: `dash.korappath.com`, path `comments`
   - Another domain entry: `dash.korappath.com`, path `submit`
   - Policy: Action **Bypass**, Include **Everyone**

   This lets visitors post comments and forms without a login. The dashboard itself stays locked, because the more specific path wins.

**6. Tell Claude to push the site changes.** Only after step 5, the pages switch to posting to `dash.korappath.com`.

**7. Remove the old address.** Delete the `comments.korappath.com` route from `wrangler.jsonc` and run `wrangler deploy` again.

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
