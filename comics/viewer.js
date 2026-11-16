// Shared comic reader for comics/<comic>/index.html.
// Shows the whole comic as one page; tapping a panel opens a guided view that glides from panel
// to panel in reading order (left to right, then down), like reading a printed comic page.
//
// Needs, before this script: PANELS (from story.js; panels may set wide:true) and COMIC:
//   { next: 'Next time: …', nextUrl: '../../stories/…html', nextLink: 'Read Chapter N →' }
(function () {
  var P = window.PANELS, C = window.COMIC || {};
  var PAGE_W = 1200, TOP_BAR = 52, BOTTOM_BAR = 64, PAD = 14;
  var TEXT_PX = 13, MIN_TEXT_PX = 11.5; // caption size on the page, and the smallest we accept on screen

  var view = document.getElementById('comic-view');
  var page = document.getElementById('comic-page');
  var counter = document.getElementById('g-counter');
  var readCard = document.getElementById('g-read');
  var prevBtn = document.getElementById('g-prev');
  var nextBtn = document.getElementById('g-next');

  var lang = 'en';
  try { if (localStorage.getItem('korappath-lang') === 'ml') lang = 'ml'; } catch (e) {}
  var guided = false, cur = 0, cells = [], pageScale = 1;

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function src(i) { return 'panels/panel-' + (i < 9 ? '0' : '') + (i + 1) + '.jpg'; }
  function stops() { return cells.length; } // panels + the end card

  function text(p) {
    var h = '';
    if (p.ml || p.en) {
      h += lang === 'ml'
        ? '<div class="cap ml" lang="ml">' + esc(p.ml) + '</div>'
        : '<div class="cap"><span class="lbl">From the chapter · AI-generated translation</span>' + esc(p.en) + '</div>';
    }
    if (p.narration) h += '<p class="narr">' + esc(p.narration) + '</p>';
    (p.bubbles || []).forEach(function (b) {
      h += '<div class="bub' + (b[2] ? ' ' + b[2] : '') + '"><span class="who">' + esc(b[0]) + '</span>' + esc(b[1]) + '</div>';
    });
    return h;
  }

  function build() {
    var h = '';
    P.forEach(function (p, i) {
      h += '<div class="cc' + (p.wide ? ' wide' : '') + '" data-i="' + i + '" tabindex="0" role="button" aria-label="Panel ' + (i + 1) + '">' +
           '<img src="' + src(i) + '" alt="' + esc(p.alt) + '" decoding="async">' +
           '<div class="cb"><div class="cn">' + (i + 1) + '</div>' + text(p) + '</div></div>';
    });
    h += '<div class="cc end" data-i="' + P.length + '" tabindex="0" aria-label="To be continued">' +
         '<div class="eyebrow">To be continued</div><div class="tbc">' + esc(C.next) + '</div>' +
         '<p>Read every chapter of the memoir in Malayalam and English at korappath.com.</p>' +
         (C.nextUrl ? '<a href="' + esc(C.nextUrl) + '">' + esc(C.nextLink) + '</a>' : '') + '</div>';
    page.innerHTML = '<div class="cgrid">' + h + '</div>';
    cells = Array.prototype.slice.call(page.querySelectorAll('.cc'));
  }

  function setTransform(tx, ty, s) {
    page.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
  }

  // Page view: the whole page scaled to the column width. Guided view: zoom so one panel fills the screen.
  function layout() {
    if (!guided) {
      pageScale = Math.min(1, view.clientWidth / PAGE_W);
      view.style.height = Math.ceil(page.offsetHeight * pageScale) + 'px';
      setTransform(0, 0, pageScale);
      return;
    }
    var el = cells[cur], target = el;
    var vw = window.innerWidth, vh = window.innerHeight - TOP_BAR - BOTTOM_BAR;
    var s = fit(el, vw, vh);
    // If this panel's text would come out too small (wide panels on a phone), zoom on the picture
    // alone and show the text full-size in a reading card under it.
    var cb = el.querySelector('.cb'), img = el.querySelector('img');
    if (cb && img && cb.textContent.trim().length > 3 && s * TEXT_PX < MIN_TEXT_PX) {
      readCard.innerHTML = cb.innerHTML;
      readCard.hidden = false;
      vh -= readCard.offsetHeight;
      target = img;
      s = fit(img, vw, vh);
    } else {
      readCard.hidden = true;
    }
    setTransform((vw - target.offsetWidth * s) / 2 - target.offsetLeft * s,
                 TOP_BAR + (vh - target.offsetHeight * s) / 2 - target.offsetTop * s, s);
  }

  function fit(el, vw, vh) {
    return Math.min((vw - 2 * PAD) / el.offsetWidth, (vh - 2 * PAD) / el.offsetHeight, 2.6);
  }

  function mark() {
    cells.forEach(function (c, k) {
      c.classList.toggle('dim', guided && k !== cur);
      c.classList.toggle('here', guided && k === cur);
    });
    counter.textContent = cur < P.length ? 'Panel ' + (cur + 1) + ' of ' + P.length : 'The end';
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === stops() - 1;
  }

  function setHash() {
    try { history.replaceState(null, '', guided ? '#' + (cur + 1) : location.pathname + location.search); } catch (e) {}
  }

  function open(i, instant) {
    cur = Math.max(0, Math.min(stops() - 1, i));
    if (!guided) {
      // Start the zoom from where the page sits on screen, so it visibly flies into the panel.
      var r = view.getBoundingClientRect();
      guided = true;
      document.body.classList.add('guided-on');
      view.classList.add('guided');
      page.style.transition = 'none';
      setTransform(r.left, r.top, pageScale);
      void page.offsetWidth;
      page.style.transition = instant ? 'none' : '';
    }
    layout();
    if (instant) { void page.offsetWidth; page.style.transition = ''; }
    mark();
    setHash();
    prevBtn.focus({ preventScroll: true });
  }

  function go(i) { if (i >= 0 && i < stops() && i !== cur) { cur = i; layout(); mark(); setHash(); } }

  function close() {
    if (!guided) return;
    guided = false;
    readCard.hidden = true;
    document.body.classList.remove('guided-on');
    view.classList.remove('guided');
    page.style.transition = 'none';
    layout();
    mark();
    setHash();
    var c = cells[cur], r = c.getBoundingClientRect();
    window.scrollBy(0, r.top - window.innerHeight / 3);
    c.focus({ preventScroll: true });
  }

  function setLang(l) {
    lang = l;
    try { localStorage.setItem('korappath-lang', lang); } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('.lang-toggle button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });
    build();
    page.style.transition = 'none';
    layout();
    mark();
    void page.offsetWidth;
    page.style.transition = '';
  }

  // ---- events ----
  page.addEventListener('click', function (e) {
    if (e.target.closest('a')) return;
    var c = e.target.closest('.cc'); if (!c) return;
    var i = +c.getAttribute('data-i');
    if (!guided) { if (i < P.length) open(i); } else go(i);
  });
  page.addEventListener('keydown', function (e) {
    var c = e.target.closest('.cc');
    if (c && !guided && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(+c.getAttribute('data-i')); }
  });
  document.getElementById('start-btn').addEventListener('click', function () { open(0); });
  document.getElementById('g-close').addEventListener('click', close);
  prevBtn.addEventListener('click', function () { go(cur - 1); });
  nextBtn.addEventListener('click', function () { go(cur + 1); });
  document.getElementById('tz-prev').addEventListener('click', function () { go(cur - 1); });
  document.getElementById('tz-next').addEventListener('click', function () { go(cur + 1); });
  document.addEventListener('keydown', function (e) {
    if (!guided) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(cur + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(cur - 1); }
    if (e.key === 'Escape') close();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.lang-toggle button'), function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); });
  });

  // Swipe left/right to move; pinch inwards to go back to the whole page.
  var t0 = null, pinch0 = null;
  function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  view.addEventListener('touchstart', function (e) {
    if (!guided) return;
    if (e.touches.length === 2) { pinch0 = dist(e.touches); t0 = null; }
    else if (e.touches.length === 1) { t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
  }, { passive: true });
  view.addEventListener('touchmove', function (e) {
    if (guided && pinch0 && e.touches.length === 2 && dist(e.touches) < pinch0 * 0.7) { pinch0 = null; close(); }
  }, { passive: true });
  view.addEventListener('touchend', function (e) {
    if (!guided || !t0) return;
    var dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(cur + (dx < 0 ? 1 : -1));
    t0 = null;
  });

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { page.style.transition = 'none'; layout(); void page.offsetWidth; page.style.transition = ''; }, 80);
  });

  function fromHash() {
    var n = parseInt((location.hash || '').slice(1), 10);
    return n >= 1 && n <= stops() ? n - 1 : -1;
  }
  window.addEventListener('hashchange', function () {
    var i = fromHash();
    if (i < 0) close(); else if (!guided) open(i, true); else go(i);
  });

  // ---- start ----
  build();
  setLang(lang);
  // Web fonts change text heights; re-measure once they're in.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
    page.style.transition = 'none'; layout(); void page.offsetWidth; page.style.transition = '';
  });
  var start = fromHash();
  if (start >= 0) open(start, true);
})();
