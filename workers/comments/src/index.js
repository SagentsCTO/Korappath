// korappath-comments — every form on korappath.com lands here (no Formspree, no GitHub writes).
//
// Public (POSTs only accepted from ALLOWED_ORIGINS):
//   GET  /comments?story=<id>   approved comments for one chapter
//   POST /comments              new comment → pending (JSON from comments.js, or a plain form post)
//   POST /submit/<kind>         story | write | tree-photo | access → private inbox (multipart form)
// Admin (Cloudflare Access + token verified here, fail closed):
//   GET  /  (or /admin)                      the dashboard: comments + submissions
//   GET  /admin/api/comments?status=…        POST /admin/api/comments/<id>     {action}
//   GET  /admin/api/submissions?status=…     POST /admin/api/submissions/<id>  {action}
//   GET  /admin/files/<id>                   an uploaded photo
// Each new comment/submission emails NOTIFY_TO through the NOTIFY send_email binding (if configured).

const LIMITS = { name: 80, text: 3000, perIpPerHour: 5, maxPending: 300, bodyBytes: 16384 };
const SUB_LIMITS = { perIpPerHour: 10, maxNew: 500, field: 5000, longField: 200000, fileBytes: 20 * 1024 * 1024, bodyBytes: 24 * 1024 * 1024 };
const STORY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

// What each public form may send. Anything not listed is ignored.
const FORMS = {
  'story': {
    label: 'Photo / story', thanks: 'Thank you for sending this in. Raju will look at it and may get in touch.',
    fields: ['name', 'email', 'relation', 'description'], required: ['name', 'email', 'description'],
    file: 'attachment', fileRequired: false,
  },
  'write': {
    label: 'Write a story', thanks: 'Your story has been sent to Raju. Thank you!',
    fields: ['name', 'email', 'story_malayalam'], required: ['name', 'email', 'story_malayalam'], long: ['story_malayalam'],
    redirect: '/write.html?sent=1',
  },
  'tree-photo': {
    label: 'Tree photo', thanks: 'Thank you! Raju will add the photo to the family tree once he has looked at it.',
    fields: ['person_name', 'person_id', 'name', 'email', 'photo_type', 'group_position', 'photo_description'], required: ['name', 'email'],
    file: 'photo', fileRequired: true,
  },
  'access': {
    label: 'Access request', thanks: 'Thank you. Raju will add you and send you an email once you can log in.',
    fields: ['name', 'email', 'relation', 'message'], required: ['name', 'email', 'relation'],
  },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/comments') return await commentsRoute(request, env, ctx, url);
      const sub = url.pathname.match(/^\/submit\/([a-z-]+)$/);
      if (sub) return await submitRoute(request, env, ctx, sub[1]);
      // The dashboard is the site root (dash.korappath.com); /admin is kept as an alias.
      if (url.pathname === '/' || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return await adminRoute(request, env, url);
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error' }, 500, corsHeaders(request, env));
    }
  },
};

// ---------- comments ----------

async function commentsRoute(request, env, ctx, url) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  if (request.method === 'GET') {
    const story = url.searchParams.get('story') || '';
    if (!STORY_ID.test(story)) return json({ error: 'Bad story id' }, 400, cors);
    const { results } = await env.DB.prepare(
      "SELECT name, text, created_at AS date FROM comments WHERE story_id = ? AND status = 'approved' ORDER BY created_at ASC LIMIT 500"
    ).bind(story).all();
    return json({ comments: results }, 200, { ...cors, 'cache-control': 'public, max-age=30' });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  // comments.js sends JSON; without JavaScript the form posts normally and gets an HTML page back.
  const isJson = (request.headers.get('content-type') || '').includes('application/json');
  const reply = (status, msg, ok) => isJson
    ? json(ok ? { ok: true } : { error: msg }, status, cors)
    : htmlPage(ok ? 'Thank you' : 'Not sent', msg, backLink(request, env), status);

  if (!allowedOrigin(request, env)) return reply(403, 'Origin not allowed');
  if (Number(request.headers.get('content-length') || 0) > LIMITS.bodyBytes) return reply(413, 'That comment is too long.');

  let body;
  try { body = isJson ? await request.json() : Object.fromEntries(await request.formData()); }
  catch { return reply(400, 'Something went wrong reading the comment.'); }

  if (body.website) return reply(200, 'Your comment will appear once it has been reviewed.', true); // honeypot

  const story = String(body.story_id || '');
  const name = clean(body.name, LIMITS.name);
  const text = clean(body.comment, LIMITS.text);
  if (!STORY_ID.test(story)) return reply(400, 'Bad story id');
  if (!name || !text) return reply(400, 'Name and comment are required');

  const ipHash = await hashIp(request, env);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, hourAgo()).first();
  if (recent.n >= LIMITS.perIpPerHour) return reply(429, 'Too many comments, please try again later');
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'").first();
  if (pending.n >= LIMITS.maxPending) return reply(503, 'Comments are paused, please try again later');

  await env.DB.prepare('INSERT INTO comments (story_id, name, text, status, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(story, name, text, 'pending', new Date().toISOString(), ipHash).run();

  ctx.waitUntil(notify(env, `New comment on ${story} from ${name}`,
    `${name} commented on ${env.SITE_URL}/stories/${story}.html\n\n${text}\n\nApprove or reject: ${adminUrl(request)}`));
  return reply(201, 'Your comment will appear once it has been reviewed.', true);
}

// ---------- form submissions ----------

async function submitRoute(request, env, ctx, kind) {
  const form = FORMS[kind];
  if (!form) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const back = backLink(request, env);
  const fail = (status, msg) => htmlPage('Not sent', msg + ' Please go back and try again.', back, status);

  if (!allowedOrigin(request, env)) return fail(403, 'This form can only be sent from korappath.com.');
  if (Number(request.headers.get('content-length') || 0) > SUB_LIMITS.bodyBytes) return fail(413, 'That is too large to send (the limit is 20 MB).');

  let data;
  try { data = await request.formData(); } catch { return fail(400, 'Something went wrong reading the form.'); }
  if (data.get('website')) return htmlPage('Thank you', form.thanks, back); // honeypot

  const fields = {};
  for (const f of form.fields) {
    const v = clean(data.get(f), (form.long || []).includes(f) ? SUB_LIMITS.longField : SUB_LIMITS.field);
    if (v) fields[f] = v;
  }
  for (const f of form.required) if (!fields[f]) return fail(400, `Please fill in "${f.replace(/_/g, ' ')}".`);
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return fail(400, 'That email address does not look right.');

  let file = form.file ? data.get(form.file) : null;
  if (!(file && typeof file === 'object' && file.size > 0)) file = null;
  if (form.fileRequired && !file) return fail(400, 'Please choose a photo.');
  if (file) {
    if (!/^image\//.test(file.type || '')) return fail(400, 'Only image files can be uploaded.');
    if (file.size > SUB_LIMITS.fileBytes) return fail(413, 'That photo is too large (the limit is 20 MB).');
  }

  const ipHash = await hashIp(request, env);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, hourAgo()).first();
  if (recent.n >= SUB_LIMITS.perIpPerHour) return fail(429, 'Too many submissions from here in the last hour.');
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'new'").first();
  if (open.n >= SUB_LIMITS.maxNew) return fail(503, 'The inbox is full right now.');

  const res = await env.DB.prepare(
    'INSERT INTO submissions (kind, fields, file_name, file_type, file_size, status, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(kind, JSON.stringify(fields), file ? clean(file.name, 200) : null, file ? file.type : null, file ? file.size : null,
    'new', new Date().toISOString(), ipHash).run();
  const id = res.meta.last_row_id;

  if (file) {
    try {
      await env.UPLOADS.put('upload/' + id, file.stream(), { metadata: { name: file.name, type: file.type, size: file.size } });
    } catch (err) {
      console.error(err);
      await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run();
      return fail(500, 'The photo could not be saved.');
    }
  }

  const lines = Object.entries(fields).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n\n');
  ctx.waitUntil(notify(env, `New ${form.label.toLowerCase()} from ${fields.name || 'someone'}`,
    `${lines}${file ? `\n\nPhoto: ${file.name} (${Math.round(file.size / 1024)} KB)` : ''}\n\nOpen the dashboard: ${adminUrl(request)}`));

  if (form.redirect) return Response.redirect(env.SITE_URL + form.redirect, 303);
  return htmlPage('Thank you', form.thanks, back);
}

// ---------- shared request helpers ----------

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function allowedOrigin(request, env) {
  return allowedOrigins(env).includes(request.headers.get('origin') || '');
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const h = { vary: 'Origin' };
  if (allowedOrigins(env).includes(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    h['access-control-allow-headers'] = 'content-type';
    h['access-control-max-age'] = '86400';
  }
  return h;
}

// Where "Back" goes on the thank-you page: the page the form was on, if it is ours.
function backLink(request, env) {
  const ref = request.headers.get('referer') || '';
  try {
    const u = new URL(ref);
    if (allowedOrigins(env).includes(u.origin)) return ref;
  } catch { /* no or bad referer */ }
  return env.SITE_URL;
}

function adminUrl(request) {
  return new URL(request.url).origin + '/';
}

function hourAgo() {
  return new Date(Date.now() - 3600e3).toISOString();
}

async function hashIp(request, env) {
  return sha256((env.IP_SALT || 'korappath') + '|' + (request.headers.get('cf-connecting-ip') || ''));
}

function clean(value, max) {
  if (value == null || typeof value === 'object') return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

async function notify(env, subject, text) {
  if (!env.NOTIFY || !env.NOTIFY_TO || !env.NOTIFY_FROM) return;
  try {
    await env.NOTIFY.send({ to: env.NOTIFY_TO, from: { email: env.NOTIFY_FROM, name: 'Korappath' }, subject: subject.slice(0, 200), text });
  } catch (err) {
    console.error('notify failed', err && err.message);
  }
}

// ---------- admin ----------

async function adminRoute(request, env, url) {
  const email = await adminIdentity(request, env, url);
  if (!email) return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });

  if ((url.pathname === '/' || url.pathname === '/admin') && request.method === 'GET') {
    return new Response(adminPage(env, email), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'self'; img-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' ${env.SITE_URL}; frame-ancestors 'none'`,
      },
    });
  }

  const file = url.pathname.match(/^\/admin\/files\/(\d+)$/);
  if (file && request.method === 'GET') {
    const obj = await env.UPLOADS.getWithMetadata('upload/' + file[1], { type: 'stream' });
    if (!obj.value) return new Response('Not found', { status: 404 });
    const meta = obj.metadata || {};
    const type = /^image\//.test(meta.type || '') ? meta.type : 'application/octet-stream';
    const name = String(meta.name || 'photo').replace(/[^\w.\- ]/g, '_');
    const disp = url.searchParams.has('download') ? 'attachment' : 'inline';
    return new Response(obj.value, {
      headers: {
        'content-type': type,
        'content-disposition': `${disp}; filename="${name}"`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, no-store',
      },
    });
  }

  if (url.pathname === '/admin/api/comments' && request.method === 'GET') {
    const status = url.searchParams.get('status') || 'pending';
    if (!['pending', 'approved', 'rejected'].includes(status)) return json({ error: 'Bad status' }, 400);
    const order = status === 'pending' ? 'ASC' : 'DESC';
    const { results } = await env.DB.prepare(
      `SELECT id, story_id, name, text, status, created_at, reviewed_at FROM comments WHERE status = ? ORDER BY created_at ${order} LIMIT 300`
    ).bind(status).all();
    return json({ comments: results, counts: await counts(env) }, 200, { 'cache-control': 'no-store' });
  }

  if (url.pathname === '/admin/api/submissions' && request.method === 'GET') {
    const status = url.searchParams.get('status') || 'new';
    if (!['new', 'done'].includes(status)) return json({ error: 'Bad status' }, 400);
    const order = status === 'new' ? 'ASC' : 'DESC';
    const { results } = await env.DB.prepare(
      `SELECT id, kind, fields, file_name, file_type, file_size, status, created_at, handled_at FROM submissions WHERE status = ? ORDER BY created_at ${order} LIMIT 300`
    ).bind(status).all();
    results.forEach(r => { r.fields = JSON.parse(r.fields || '{}'); r.label = (FORMS[r.kind] || {}).label || r.kind; });
    return json({ submissions: results, counts: await counts(env) }, 200, { 'cache-control': 'no-store' });
  }

  // State-changing calls must carry our custom header with a JSON body. Browsers won't send
  // that cross-site without a CORS preflight, which these routes never approve (CSRF guard).
  const m = url.pathname.match(/^\/admin\/api\/(comments|submissions)\/(\d+)$/);
  if (m && request.method === 'POST') {
    if (request.headers.get('x-korappath-admin') !== '1' || !(request.headers.get('content-type') || '').includes('application/json')) {
      return json({ error: 'Bad request' }, 400);
    }
    const { action } = await request.json();
    const id = Number(m[2]);
    const now = new Date().toISOString();
    if (m[1] === 'comments') {
      if (action === 'delete') {
        await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
      } else if (['approve', 'reject', 'pending'].includes(action)) {
        const status = { approve: 'approved', reject: 'rejected', pending: 'pending' }[action];
        await env.DB.prepare('UPDATE comments SET status = ?, reviewed_at = ? WHERE id = ?')
          .bind(status, action === 'pending' ? null : now, id).run();
      } else return json({ error: 'Bad action' }, 400);
    } else {
      if (action === 'delete') {
        await env.UPLOADS.delete('upload/' + id);
        await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run();
      } else if (action === 'done' || action === 'new') {
        await env.DB.prepare('UPDATE submissions SET status = ?, handled_at = ? WHERE id = ?')
          .bind(action, action === 'done' ? now : null, id).run();
      } else return json({ error: 'Bad action' }, 400);
    }
    console.log(`admin ${email} ${action} ${m[1]} ${id}`);
    return json({ ok: true });
  }

  return new Response('Not found', { status: 404 });
}

async function counts(env) {
  const c = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM comments GROUP BY status').all();
  const s = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM submissions GROUP BY status').all();
  return {
    comments: Object.fromEntries(c.results.map(r => [r.status, r.n])),
    submissions: Object.fromEntries(s.results.map(r => [r.status, r.n])),
  };
}

// Returns the moderator's email, or null. Fails closed: no AUD, no allow-list, bad token → null.
async function adminIdentity(request, env, url) {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (local && env.DEV_ADMIN_BYPASS === '1') return 'local-dev';
  return verifyAccessToken(request.headers.get('cf-access-jwt-assertion'), env);
}

let jwks = null, jwksFetchedAt = 0;
async function accessKeys(env, force) {
  if (!force && jwks && Date.now() - jwksFetchedAt < 3600e3) return jwks;
  const r = await fetch(env.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs');
  if (!r.ok) throw new Error('Could not fetch Access certs');
  jwks = (await r.json()).keys || [];
  jwksFetchedAt = Date.now();
  return jwks;
}

async function verifyAccessToken(token, env) {
  if (!token || !env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) return null;
  const allowed = (env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch { return null; }
  if (header.alg !== 'RS256') return null;

  let jwk = (await accessKeys(env)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(env, true)).find(k => k.kid === header.kid); // key rotation
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss !== env.ACCESS_TEAM_DOMAIN) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  const email = String(payload.email || '').toLowerCase();
  return allowed.includes(email) ? email : null;
}

// ---------- helpers ----------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

function b64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Noto+Serif+Malayalam:wght@400&family=Work+Sans:wght@400;500&family=Space+Mono&display=swap" rel="stylesheet">';
const BASE_CSS = `:root{ --oxide-dark:#3E1810; --oxide:#6B2A1E; --brass:#C6952F; --brass-light:#E8C776; --ivory:#F1E9D6; --ivory-dim:#D8CBAE; --teak:#2B1D14; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ background:var(--oxide-dark); color:var(--ivory); font-family:'Work Sans','Noto Serif Malayalam',sans-serif; padding:24px 16px 60px; }
  h1{ font-family:'Fraunces',serif; font-weight:600; }`;

// Thank-you / error page shown after a plain form post.
function htmlPage(title, message, back, status = 200) {
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} · Korappath</title>${FONTS}
<style>${BASE_CSS}
  main{ max-width:520px; margin:12vh auto 0; text-align:center; }
  .mark{ font-family:'Fraunces',serif; font-size:1.2rem; letter-spacing:.02em; color:var(--brass-light); margin-bottom:28px; }
  h1{ font-size:2.2rem; margin-bottom:14px; }
  p{ color:var(--ivory-dim); line-height:1.6; margin-bottom:28px; }
  a{ display:inline-block; font-family:'Space Mono',monospace; font-size:.8rem; letter-spacing:.06em; text-transform:uppercase; padding:.8rem 1.5rem; background:var(--brass); color:var(--teak); text-decoration:none; border-radius:2px; }
</style></head>
<body><main><div class="mark">Korappath.</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
<a href="${escapeHtml(back)}">← Back to Korappath</a></main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
}

function adminPage(env, email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Dashboard · Korappath</title>
${FONTS}
<style>${BASE_CSS}
  main{ max-width:760px; margin:0 auto; }
  header{ display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; border-bottom:1px solid rgba(198,149,47,.4); padding-bottom:14px; margin-bottom:18px; }
  h1{ font-size:1.8rem; }
  .who{ font-family:'Space Mono',monospace; font-size:.72rem; color:var(--ivory-dim); }
  .tabs{ display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
  .tabs button{ font-family:'Space Mono',monospace; font-size:.75rem; letter-spacing:.06em; text-transform:uppercase; padding:.55rem 1rem; border:1px solid var(--brass); background:transparent; color:var(--brass-light); border-radius:2px; cursor:pointer; }
  .tabs button.on{ background:var(--brass); color:var(--teak); }
  .tabs.sub button{ font-size:.68rem; padding:.4rem .8rem; border-color:rgba(198,149,47,.5); }
  .tabs.sub{ margin-bottom:18px; }
  .card{ background:var(--oxide); border:1px solid rgba(198,149,47,.3); border-radius:4px; padding:14px 16px; margin-bottom:12px; }
  .meta{ font-family:'Space Mono',monospace; font-size:.7rem; letter-spacing:.04em; text-transform:uppercase; color:var(--brass-light); margin-bottom:4px; }
  .story{ font-size:.85rem; color:var(--ivory-dim); margin-bottom:8px; }
  .story a{ color:var(--ivory-dim); }
  .text{ white-space:pre-wrap; line-height:1.55; margin-bottom:12px; }
  dl{ margin:8px 0 12px; }
  dt{ font-family:'Space Mono',monospace; font-size:.66rem; letter-spacing:.05em; text-transform:uppercase; color:var(--ivory-dim); opacity:.8; margin-top:8px; }
  dd{ white-space:pre-wrap; line-height:1.5; }
  dd.long{ max-height:14em; overflow:auto; background:rgba(0,0,0,.15); padding:8px; border-radius:3px; }
  .photo{ margin:4px 0 12px; }
  .photo img{ max-width:100%; max-height:320px; border-radius:3px; display:block; margin-bottom:6px; }
  .photo a{ color:var(--brass-light); font-size:.85rem; margin-right:14px; }
  .hint{ font-size:.82rem; color:var(--brass-light); margin-bottom:10px; }
  .actions{ display:flex; gap:8px; flex-wrap:wrap; }
  .actions button{ font-family:'Space Mono',monospace; font-size:.72rem; letter-spacing:.05em; text-transform:uppercase; padding:.5rem .9rem; border-radius:2px; border:none; cursor:pointer; }
  .approve{ background:var(--brass); color:var(--teak); }
  .reject{ background:transparent; color:var(--ivory); border:1px solid var(--ivory-dim) !important; }
  .delete{ background:transparent; color:#e8a08f; border:1px solid #8c3e2c !important; margin-left:auto; }
  .empty, .err{ color:var(--ivory-dim); padding:20px 0; }
  .err{ color:#e8a08f; }
</style>
</head>
<body>
<main>
  <header><h1>Korappath dashboard</h1><span class="who">${escapeHtml(email)}</span></header>
  <div class="tabs" id="area">
    <button data-a="comments" class="on">Comments</button>
    <button data-a="submissions">Submissions</button>
  </div>
  <div class="tabs sub" id="status"></div>
  <div id="list"><p class="empty">Loading…</p></div>
</main>
<script>
var SITE = ${JSON.stringify(env.SITE_URL)};
var STATUSES = { comments: ['pending', 'approved', 'rejected'], submissions: ['new', 'done'] };
var NAMES = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', new: 'New', done: 'Done' };
var area = 'comments', status = 'pending', titles = {}, lastCounts = null;

fetch(SITE + '/stories.json').then(function (r) { return r.json(); }).then(function (s) {
  s.forEach(function (x) { titles[x.id] = { title: x.titleEn, url: SITE + '/' + x.storyUrl }; });
  load();
}).catch(load);

document.querySelectorAll('#area button').forEach(function (b) {
  b.onclick = function () {
    area = b.dataset.a; status = STATUSES[area][0];
    document.querySelectorAll('#area button').forEach(function (x) { x.classList.toggle('on', x === b); });
    load();
  };
});

function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function when(iso) { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }

function drawTabs(c) {
  lastCounts = c || lastCounts || { comments: {}, submissions: {} };
  var a = document.querySelector('[data-a=comments]'), s = document.querySelector('[data-a=submissions]');
  a.textContent = 'Comments' + (lastCounts.comments.pending ? ' (' + lastCounts.comments.pending + ')' : '');
  s.textContent = 'Submissions' + (lastCounts.submissions.new ? ' (' + lastCounts.submissions.new + ')' : '');
  var box = document.getElementById('status'); box.innerHTML = '';
  STATUSES[area].forEach(function (st) {
    var b = el('button', st === status ? 'on' : '', NAMES[st] + ' (' + (lastCounts[area][st] || 0) + ')');
    b.onclick = function () { status = st; load(); };
    box.appendChild(b);
  });
}

function load() {
  var list = document.getElementById('list');
  fetch('/admin/api/' + area + '?status=' + status).then(function (r) { if (!r.ok) throw r; return r.json(); }).then(function (d) {
    drawTabs(d.counts);
    list.innerHTML = '';
    var items = d[area];
    if (!items.length) { list.appendChild(el('p', 'empty', status === 'pending' || status === 'new' ? 'Nothing waiting. All caught up.' : 'None.')); return; }
    items.forEach(function (it) { list.appendChild(area === 'comments' ? commentCard(it) : submissionCard(it)); });
  }).catch(function () { list.innerHTML = ''; list.appendChild(el('p', 'err', 'Could not load.')); });
}

function commentCard(cm) {
  var d = el('div', 'card');
  d.appendChild(el('div', 'meta', cm.name + ' · ' + when(cm.created_at)));
  var st = el('div', 'story'), t = titles[cm.story_id];
  if (t) { var a = el('a', null, t.title); a.href = t.url; a.target = '_blank'; a.rel = 'noopener'; st.appendChild(a); }
  else st.textContent = cm.story_id;
  d.appendChild(st);
  d.appendChild(el('div', 'text', cm.text));
  var act = el('div', 'actions');
  if (cm.status !== 'approved') act.appendChild(btn('Approve', 'approve', 'comments', cm.id, 'approve'));
  if (cm.status !== 'rejected') act.appendChild(btn(cm.status === 'approved' ? 'Unpublish' : 'Reject', 'reject', 'comments', cm.id, 'reject'));
  if (cm.status === 'rejected') act.appendChild(btn('Back to pending', 'reject', 'comments', cm.id, 'pending'));
  act.appendChild(btn('Delete', 'delete', 'comments', cm.id, 'delete'));
  d.appendChild(act);
  return d;
}

var LONG = { story_malayalam: 1, description: 1, photo_description: 1 };
function submissionCard(s) {
  var d = el('div', 'card');
  d.appendChild(el('div', 'meta', s.label + ' · ' + when(s.created_at)));
  if (s.kind === 'access') d.appendChild(el('div', 'hint', 'To let them in: add their email to the Access policy, email them, then mark this done.'));
  if (s.kind === 'tree-photo' && s.fields.person_name) d.appendChild(el('div', 'hint', 'Photo for: ' + s.fields.person_name));
  var dl = el('dl');
  Object.keys(s.fields).forEach(function (k) {
    if (k === 'person_name' || k === 'person_id') return;
    dl.appendChild(el('dt', null, k.replace(/_/g, ' ')));
    var dd = el('dd', LONG[k] ? 'long' : null, s.fields[k]);
    if (k === 'story_malayalam') dd.lang = 'ml';
    dl.appendChild(dd);
  });
  d.appendChild(dl);
  if (s.file_name) {
    var p = el('div', 'photo'), src = '/admin/files/' + s.id;
    var img = el('img'); img.src = src; img.alt = s.file_name; img.loading = 'lazy';
    var open = el('a', null, 'Open full size'); open.href = src; open.target = '_blank'; open.rel = 'noopener';
    var dl2 = el('a', null, 'Download ' + s.file_name + ' (' + Math.round(s.file_size / 1024) + ' KB)'); dl2.href = src + '?download';
    p.appendChild(img); p.appendChild(open); p.appendChild(dl2);
    d.appendChild(p);
  }
  var act = el('div', 'actions');
  act.appendChild(s.status === 'new' ? btn('Mark done', 'approve', 'submissions', s.id, 'done') : btn('Back to new', 'reject', 'submissions', s.id, 'new'));
  act.appendChild(btn('Delete', 'delete', 'submissions', s.id, 'delete'));
  d.appendChild(act);
  return d;
}

function btn(label, cls, kind, id, action) {
  var b = el('button', cls, label);
  b.onclick = function () {
    if (action === 'delete' && !confirm('Delete this permanently' + (kind === 'submissions' ? ', including any photo' : '') + '? This cannot be undone.')) return;
    b.disabled = true;
    fetch('/admin/api/' + kind + '/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-korappath-admin': '1' },
      body: JSON.stringify({ action: action })
    }).then(function (r) { if (!r.ok) throw r; load(); })
      .catch(function () { b.disabled = false; alert('That did not work. Please try again.'); });
  };
  return b;
}
</script>
</body>
</html>`;
}
