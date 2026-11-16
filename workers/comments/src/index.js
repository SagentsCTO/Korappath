// korappath-comments — comment store and approval page for korappath.com.
//
// Nothing here writes to GitHub. Visitors' comments land in D1 as 'pending';
// they only appear on the site after Raju approves them on /admin.
//
// Public routes (CORS-limited to ALLOWED_ORIGINS):
//   GET  /comments?story=<id>   approved comments for one chapter
//   POST /comments              submit a comment (JSON: story_id, name, comment, website[honeypot])
// Admin routes (Cloudflare Access + token verified here, fail closed):
//   GET  /admin                         approval page
//   GET  /admin/api/comments?status=…   list comments
//   POST /admin/api/comments/<id>       {action: approve|reject|pending|delete}

const LIMITS = { name: 80, text: 3000, perIpPerHour: 5, maxPending: 300, bodyBytes: 16384 };
const STORY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/comments') return await publicRoute(request, env, url);
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return await adminRoute(request, env, url);
      if (url.pathname === '/') return new Response('korappath comments', { headers: { 'content-type': 'text/plain' } });
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error' }, 500, corsHeaders(request, env));
    }
  },
};

// ---------- public ----------

async function publicRoute(request, env, url) {
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

  if (request.method === 'POST') {
    if (!cors['access-control-allow-origin']) return json({ error: 'Origin not allowed' }, 403, cors);
    const len = Number(request.headers.get('content-length') || 0);
    if (len > LIMITS.bodyBytes) return json({ error: 'Too large' }, 413, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, cors); }

    // Honeypot: real people never fill the hidden "website" field. Pretend success.
    if (body.website) return json({ ok: true }, 200, cors);

    const story = String(body.story_id || '');
    const name = clean(body.name, LIMITS.name);
    const text = clean(body.comment, LIMITS.text);
    if (!STORY_ID.test(story)) return json({ error: 'Bad story id' }, 400, cors);
    if (!name || !text) return json({ error: 'Name and comment are required' }, 400, cors);

    const ipHash = await sha256((env.IP_SALT || 'korappath') + '|' + (request.headers.get('cf-connecting-ip') || ''));
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?')
      .bind(ipHash, hourAgo).first();
    if (recent.n >= LIMITS.perIpPerHour) return json({ error: 'Too many comments, please try again later' }, 429, cors);
    const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'").first();
    if (pending.n >= LIMITS.maxPending) return json({ error: 'Comments are paused, please try again later' }, 503, cors);

    await env.DB.prepare('INSERT INTO comments (story_id, name, text, status, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(story, name, text, 'pending', new Date().toISOString(), ipHash).run();
    return json({ ok: true }, 201, cors);
  }

  return json({ error: 'Method not allowed' }, 405, cors);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = { vary: 'Origin' };
  if (allowed.includes(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    h['access-control-allow-headers'] = 'content-type';
    h['access-control-max-age'] = '86400';
  }
  return h;
}

function clean(value, max) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

// ---------- admin ----------

async function adminRoute(request, env, url) {
  const email = await adminIdentity(request, env, url);
  if (!email) return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });

  if (url.pathname === '/admin' && request.method === 'GET') {
    return new Response(adminPage(env, email), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' ${env.SITE_URL}; frame-ancestors 'none'`,
      },
    });
  }

  // State-changing calls must carry our custom header with a JSON body. Browsers won't send
  // that cross-site without a CORS preflight, which this route never approves (CSRF guard).
  if (url.pathname === '/admin/api/comments' && request.method === 'GET') {
    const status = url.searchParams.get('status') || 'pending';
    if (!['pending', 'approved', 'rejected'].includes(status)) return json({ error: 'Bad status' }, 400);
    const order = status === 'pending' ? 'ASC' : 'DESC';
    const { results } = await env.DB.prepare(
      `SELECT id, story_id, name, text, status, created_at, reviewed_at FROM comments WHERE status = ? ORDER BY created_at ${order} LIMIT 300`
    ).bind(status).all();
    const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM comments GROUP BY status').all();
    return json({ comments: results, counts: Object.fromEntries(counts.results.map(r => [r.status, r.n])) }, 200, { 'cache-control': 'no-store' });
  }

  const m = url.pathname.match(/^\/admin\/api\/comments\/(\d+)$/);
  if (m && request.method === 'POST') {
    if (request.headers.get('x-korappath-admin') !== '1' || !(request.headers.get('content-type') || '').includes('application/json')) {
      return json({ error: 'Bad request' }, 400);
    }
    const { action } = await request.json();
    const id = Number(m[1]);
    const now = new Date().toISOString();
    if (action === 'delete') {
      await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
    } else if (['approve', 'reject', 'pending'].includes(action)) {
      const status = { approve: 'approved', reject: 'rejected', pending: 'pending' }[action];
      await env.DB.prepare('UPDATE comments SET status = ?, reviewed_at = ? WHERE id = ?')
        .bind(status, action === 'pending' ? null : now, id).run();
    } else {
      return json({ error: 'Bad action' }, 400);
    }
    console.log(`admin ${email} ${action} comment ${id}`);
    return json({ ok: true });
  }

  return new Response('Not found', { status: 404 });
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

function adminPage(env, email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Comments · Korappath</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Noto+Serif+Malayalam:wght@400&family=Work+Sans:wght@400;500&family=Space+Mono&display=swap" rel="stylesheet">
<style>
  :root{ --oxide-dark:#3E1810; --oxide:#6B2A1E; --brass:#C6952F; --brass-light:#E8C776; --ivory:#F1E9D6; --ivory-dim:#D8CBAE; --teak:#2B1D14; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ background:var(--oxide-dark); color:var(--ivory); font-family:'Work Sans','Noto Serif Malayalam',sans-serif; padding:24px 16px 60px; }
  main{ max-width:760px; margin:0 auto; }
  header{ display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; border-bottom:1px solid rgba(198,149,47,.4); padding-bottom:14px; margin-bottom:18px; }
  h1{ font-family:'Fraunces',serif; font-weight:600; font-size:1.8rem; }
  .who{ font-family:'Space Mono',monospace; font-size:.72rem; color:var(--ivory-dim); }
  .tabs{ display:flex; gap:8px; margin-bottom:18px; flex-wrap:wrap; }
  .tabs button{ font-family:'Space Mono',monospace; font-size:.75rem; letter-spacing:.06em; text-transform:uppercase; padding:.55rem 1rem; border:1px solid var(--brass); background:transparent; color:var(--brass-light); border-radius:2px; cursor:pointer; }
  .tabs button.on{ background:var(--brass); color:var(--teak); }
  .card{ background:var(--oxide); border:1px solid rgba(198,149,47,.3); border-radius:4px; padding:14px 16px; margin-bottom:12px; }
  .meta{ font-family:'Space Mono',monospace; font-size:.7rem; letter-spacing:.04em; text-transform:uppercase; color:var(--brass-light); margin-bottom:4px; }
  .story{ font-size:.85rem; color:var(--ivory-dim); margin-bottom:8px; }
  .story a{ color:var(--ivory-dim); }
  .text{ white-space:pre-wrap; line-height:1.55; margin-bottom:12px; }
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
  <header><h1>Comments to review</h1><span class="who">${escapeHtml(email)}</span></header>
  <div class="tabs">
    <button data-s="pending" class="on">Pending</button>
    <button data-s="approved">Approved</button>
    <button data-s="rejected">Rejected</button>
  </div>
  <div id="list"><p class="empty">Loading…</p></div>
</main>
<script>
var SITE = ${JSON.stringify(env.SITE_URL)};
var status = 'pending', titles = {};
fetch(SITE + '/stories.json').then(function (r) { return r.json(); }).then(function (s) {
  s.forEach(function (x) { titles[x.id] = { title: x.titleEn, url: SITE + '/' + x.storyUrl }; });
  load();
}).catch(load);

document.querySelectorAll('.tabs button').forEach(function (b) {
  b.onclick = function () {
    status = b.dataset.s;
    document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    load();
  };
});

function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function load() {
  var list = document.getElementById('list');
  fetch('/admin/api/comments?status=' + status).then(function (r) { if (!r.ok) throw r; return r.json(); }).then(function (d) {
    var c = d.counts || {};
    document.querySelector('[data-s=pending]').textContent = 'Pending (' + (c.pending || 0) + ')';
    document.querySelector('[data-s=approved]').textContent = 'Approved (' + (c.approved || 0) + ')';
    document.querySelector('[data-s=rejected]').textContent = 'Rejected (' + (c.rejected || 0) + ')';
    list.innerHTML = '';
    if (!d.comments.length) { list.appendChild(el('p', 'empty', status === 'pending' ? 'Nothing waiting. All caught up.' : 'None.')); return; }
    d.comments.forEach(function (cm) { list.appendChild(card(cm)); });
  }).catch(function () { list.innerHTML = ''; list.appendChild(el('p', 'err', 'Could not load comments.')); });
}

function card(cm) {
  var d = el('div', 'card');
  d.appendChild(el('div', 'meta', cm.name + ' · ' + new Date(cm.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })));
  var st = el('div', 'story'), t = titles[cm.story_id];
  if (t) { var a = el('a', null, t.title); a.href = t.url; a.target = '_blank'; a.rel = 'noopener'; st.appendChild(a); }
  else st.textContent = cm.story_id;
  d.appendChild(st);
  d.appendChild(el('div', 'text', cm.text));
  var act = el('div', 'actions');
  if (cm.status !== 'approved') act.appendChild(btn('Approve', 'approve', cm.id, 'approve'));
  if (cm.status !== 'rejected') act.appendChild(btn(cm.status === 'approved' ? 'Unpublish' : 'Reject', 'reject', cm.id, 'reject'));
  if (cm.status === 'rejected') act.appendChild(btn('Back to pending', 'reject', cm.id, 'pending'));
  act.appendChild(btn('Delete', 'delete', cm.id, 'delete'));
  d.appendChild(act);
  return d;
}

function btn(label, cls, id, action) {
  var b = el('button', cls, label);
  b.onclick = function () {
    if (action === 'delete' && !confirm('Delete this comment permanently? This cannot be undone.')) return;
    b.disabled = true;
    fetch('/admin/api/comments/' + id, {
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

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
