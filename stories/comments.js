// Live comments for chapter pages.
//
// Shows approved comments from the comments Worker (dash.korappath.com), plus any
// older comments kept in stories.json. New comments go to the Worker as "pending" (it emails
// Raju); nothing appears publicly until he approves it on https://dash.korappath.com.
// Without JavaScript the form still works: it posts straight to the Worker.
//
// Each chapter page calls KorappathComments.init(commentsFromStoriesJson) once stories.json
// has loaded. The story id is read from the form's hidden story_id field.
var KorappathComments = (function () {
  var API = 'https://dash.korappath.com';
  // Local testing only: on localhost, ?commentsApi=http://localhost:8787 points at `wrangler dev`.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    var m = location.search.match(/[?&]commentsApi=([^&]+)/);
    if (m) API = decodeURIComponent(m[1]);
  }

  var legacy = [], storyId = '', list = null, form = null;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(comments) {
    if (!list) return;
    if (!comments.length) {
      list.innerHTML = '<p class="comment-empty">No comments yet — be the first to share a memory.</p>';
      return;
    }
    comments = comments.slice().sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); });
    list.innerHTML = comments.map(function (c) {
      var dateStr = c.date ? new Date(c.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return '<div class="comment-card">' +
        '<div class="comment-meta">' + esc(c.name) + (dateStr ? ' · ' + dateStr : '') + '</div>' +
        '<p style="white-space:pre-line">' + esc(c.text) + '</p>' +
        '</div>';
    }).join('');
  }

  function load() {
    return fetch(API + '/comments?story=' + encodeURIComponent(storyId))
      .then(function (r) { if (!r.ok) throw r; return r.json(); })
      .then(function (d) { render(legacy.concat(d.comments || [])); })
      .catch(function () { render(legacy); });
  }

  function note(msg, isError) {
    var p = document.getElementById('comment-status');
    if (!p) {
      p = document.createElement('p');
      p.id = 'comment-status';
      p.className = 'comment-note';
      p.setAttribute('role', 'status');
      form.parentNode.insertBefore(p, form.nextSibling);
    }
    p.textContent = msg;
    p.style.color = isError ? '#e8a08f' : '';
    p.style.opacity = '1';
  }

  function onSubmit(e) {
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    var data = new FormData(form);
    var payload = {
      story_id: storyId,
      name: data.get('name'),
      comment: data.get('comment'),
      website: data.get('website') || ''
    };
    if (payload.website) { form.reset(); note('Thank you! Your comment will appear here once it has been reviewed.'); return; }
    btn.disabled = true;
    note('Sending…');

    function done(ok, msg) {
      btn.disabled = false;
      if (ok) { form.reset(); note('Thank you! Your comment will appear here once it has been reviewed.'); }
      else note(msg || 'Sorry, your comment could not be sent. Please try again in a little while.', true);
    }

    // The Worker stores it as pending and emails Raju.
    fetch(API + '/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { done(r.ok, d.error); });
    }).catch(function () { done(false); });
  }

  function init(storiesJsonComments) {
    legacy = Array.isArray(storiesJsonComments) ? storiesJsonComments : [];
    list = document.getElementById('comments-list');
    form = document.getElementById('comment-form');
    var idField = form && form.querySelector('input[name="story_id"]');
    storyId = idField ? idField.value : '';
    if (!storyId) { render(legacy); return; }

    if (form && !form.dataset.live) {
      form.dataset.live = '1';
      // Honeypot field, hidden from people; bots tend to fill it in.
      var hp = document.createElement('div');
      hp.setAttribute('aria-hidden', 'true');
      hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden';
      hp.innerHTML = '<label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>';
      form.appendChild(hp);
      form.addEventListener('submit', onSubmit);
    }
    load();
  }

  return { init: init, reload: load };
})();
