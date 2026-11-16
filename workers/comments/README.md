# korappath-comments

This Cloudflare Worker stores chapter comments and serves the approval page.

- **Public API:** `https://comments.korappath.com/comments`
- **Approval page:** `https://comments.korappath.com/admin`, which only Raju can open

How it works:

1. A visitor posts a comment. The Worker stores it as **pending**, and Formspree emails Raju as before.
2. Raju opens `/admin` and taps **Approve**.
3. The comment shows on the chapter page straight away.
4. Nothing ever writes to GitHub.

## One-time setup

Run these from this folder (`workers/comments/`).

**1. Log in to Cloudflare.** This opens a browser window.

```bash
wrangler login
```

**2. Create the database.** Copy the `database_id` it prints into `wrangler.jsonc`, replacing `REPLACE_WITH_DATABASE_ID`.

```bash
wrangler d1 create korappath-comments
```

**3. Create the table.**

```bash
wrangler d1 execute korappath-comments --remote --file=schema.sql
```

**4. Deploy.** This also creates `comments.korappath.com`.

```bash
wrangler deploy
```

**5. Protect `/admin` with Cloudflare Access.** In the Cloudflare dashboard:

1. Go to **Zero Trust → Access → Applications → Add → Self-hosted**.
2. Name it "Korappath comments admin".
3. Set the domain to `comments.korappath.com` and the path to `admin`.
4. Add a policy: **Allow**, with **Emails** set to your email.
5. Save, then copy the app's **Application Audience (AUD) Tag**.

**6. Set the secrets.** Each command prompts for its value, which never goes into git.

```bash
wrangler secret put ACCESS_AUD
```

Paste the AUD tag from step 5.

```bash
wrangler secret put ADMIN_EMAILS
```

Enter your email. For more than one moderator, separate the emails with commas.

```bash
wrangler secret put IP_SALT
```

Enter any long random string.

**7. Test it.**

1. Open `https://comments.korappath.com/admin`. Cloudflare should ask for your email code, then show "Comments to review".
2. Post a test comment on any chapter.
3. Approve it, refresh the chapter, and check the comment appears.
4. Delete the test comment.

The Worker checks the Access token itself. Until steps 5 and 6 are done, `/admin` answers **Forbidden** to everyone, including you. That is expected.

### Things to check

- The team domain in `wrangler.jsonc` (`ACCESS_TEAM_DOMAIN`) is assumed to be `https://falling-math-473a.cloudflareaccess.com`, based on the team name in `specs.md`. Confirm it under **Zero Trust → Settings → Custom pages**, or under **Team domain**.
- The pages send the email notification to Formspree from the browser. If reCAPTCHA is switched on for form `xqerojyy` in Formspree, the email part fails. The comment is still stored, but you won't get the email. If that happens, turn reCAPTCHA off for that form; the Worker has its own spam checks.

## Local testing

```bash
printf 'ALLOWED_ORIGINS=http://localhost:8123\nDEV_ADMIN_BYPASS=1\n' > .dev.vars
```

```bash
wrangler d1 execute korappath-comments --local --file=schema.sql
```

```bash
wrangler dev --local --port 8787 --local-upstream localhost:8787
```

Then serve the site on port 8123 and open a chapter with `?commentsApi=http://localhost:8787`. Open `http://localhost:8787/admin` to approve comments.

`DEV_ADMIN_BYPASS` only works when the request host is `localhost`. `.dev.vars` is git-ignored and never deployed.
