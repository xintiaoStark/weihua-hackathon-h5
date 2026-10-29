(function () {
  'use strict';

  var P = window.Plush;
  var root = document.getElementById('felt');
  if (!root || !P) return;

  var TIMEOUT = 80000;
  var TIPS = ['正在挑选彩色羊毛…', '正在一针一针戳出你的发型…', '正在给毛毡小人穿上衣服…', '正在把绒毛修得更蓬松…', '马上就好，长垣见！'];

  function $(id) { return document.getElementById(id); }
  var frame = $('feltFrame');
  var input = $('feltInput');
  var photoEl = $('feltPhoto');
  var empty = $('feltEmpty');
  var loading = $('feltLoading');
  var hint = $('feltHint');
  var goBtn = $('feltGo');
  var errorEl = $('feltError');
  var nick = $('feltNick');
  var postBtn = $('feltPost');
  var postError = $('feltPostError');
  var steps = root.querySelectorAll('[data-step]');

  var photo = null;
  var photoUrl = '';
  var view = { x: 0, y: 0, s: 1 };
  var aiOk = null;
  var busy = null;
  var result = null;

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function loadImg(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('图片读不出来，换一张试试')); };
      im.src = src;
    });
  }
  function showError(el, msg) {
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  function netMessage(e) {
    if (e && e.name === 'AbortError') return 'AI 这会儿有点忙，再点一次试试';
    if (e && /Failed to fetch|NetworkError|Load failed|network/i.test(e.message)) return '网络不太好，再点一次试试';
    return (e && e.message) || 'AI 开小差了，稍后再试';
  }

  function step(name) {
    for (var i = 0; i < steps.length; i++) steps[i].hidden = steps[i].getAttribute('data-step') !== name;
  }

  /* ---------- photo framing ---------- */

  function apply() {
    photoEl.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.s + ')';
  }
  function fit() {
    if (!photo) return;
    var fw = frame.clientWidth;
    var fh = frame.clientHeight;
    var s = Math.max(fw / photo.width, fh / photo.height);
    // faces sit in the upper part of most portraits, so keep more of the top in view
    view = { s: s, x: (fw - photo.width * s) / 2, y: (fh - photo.height * s) / 3 };
    photoEl.style.width = photo.width + 'px';
    photoEl.style.height = photo.height + 'px';
    apply();
  }
  function zoomAt(k, cx, cy) {
    var r = frame.getBoundingClientRect();
    var px = cx - r.left;
    var py = cy - r.top;
    var s = clamp(view.s * k, 0.05, 10);
    k = s / view.s;
    view.x = px - (px - view.x) * k;
    view.y = py - (py - view.y) * k;
    view.s = s;
    apply();
  }

  function pick() {
    if (busy) return;
    input.click();
  }

  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    if (!f) return;
    var url = URL.createObjectURL(f);
    loadImg(url).then(function (im) {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = url;
      photo = im;
      photoEl.src = url;
      photoEl.hidden = false;
      empty.hidden = true;
      hint.hidden = false;
      frame.classList.add('has-photo');
      showError(errorEl, '');
      step('photo');
      fit();
    }).catch(function () {
      URL.revokeObjectURL(url);
      showError(errorEl, '这张照片读不出来，换一张试试');
    });
    input.value = '';
  });

  // drag to move, pinch or wheel to zoom; a tap without movement opens the picker
  var pts = {};
  var count = 0;
  var moved = 0;
  var pinch0 = null;
  frame.addEventListener('pointerdown', function (e) {
    if (busy) return;
    if (frame.setPointerCapture) frame.setPointerCapture(e.pointerId);
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    count = Object.keys(pts).length;
    if (count === 1) moved = 0;
    pinch0 = null;
  });
  frame.addEventListener('pointermove', function (e) {
    var p = pts[e.pointerId];
    if (!p || !photo || busy) return;
    var dx = e.clientX - p.x;
    var dy = e.clientY - p.y;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var list = Object.keys(pts).map(function (k) { return pts[k]; });
    if (list.length === 1) {
      view.x += dx;
      view.y += dy;
      moved += Math.abs(dx) + Math.abs(dy);
      apply();
    } else if (list.length === 2) {
      var a = list[0];
      var b = list[1];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0) zoomAt(d / pinch0, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch0 = d;
      moved += 10;
    }
  });
  function end(e) {
    if (!pts[e.pointerId]) return;
    delete pts[e.pointerId];
    count = Object.keys(pts).length;
    pinch0 = null;
    if (count === 0 && moved < 6 && !busy) pick();
  }
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  frame.addEventListener('wheel', function (e) {
    if (!photo || busy) return;
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.08 : 1 / 1.08, e.clientX, e.clientY);
  }, { passive: false });
  frame.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  });
  window.addEventListener('resize', fit);

  // what the visitor framed, at most 1024 px on the long side
  function framedJpeg() {
    var fw = frame.clientWidth;
    var fh = frame.clientHeight;
    var rx = -view.x / view.s;
    var ry = -view.y / view.s;
    var rw = fw / view.s;
    var rh = fh / view.s;
    var k = Math.min(1, 1024 / Math.max(rw, rh));
    var c = canvas(Math.max(1, Math.round(rw * k)), Math.max(1, Math.round(rh * k)));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo, rx, ry, rw, rh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  }

  /* ---------- clean up the AI picture ---------- */

  // The model paints on white. Anything near-white that touches the border becomes pure white
  // (so CSS / canvas multiply blends it into the pastel cards without a box), then the figure is
  // trimmed so every avatar fills its frame the same way.
  function tidy(im) {
    var k = Math.min(1, 900 / Math.max(im.width, im.height));
    var w = Math.round(im.width * k);
    var h = Math.round(im.height * k);
    var c = canvas(w, h);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(im, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    var d = data.data;

    var br = 0, bg = 0, bb = 0, n = 0;
    function acc(p) { br += d[p * 4]; bg += d[p * 4 + 1]; bb += d[p * 4 + 2]; n++; }
    for (var x = 0; x < w; x += 3) { acc(x); acc((h - 1) * w + x); }
    for (var y = 0; y < h; y += 3) { acc(y * w); acc(y * w + w - 1); }
    br /= n; bg /= n; bb /= n;

    if (br > 200 && bg > 200 && bb > 200) {
      var T = 24;
      var dist = function (p) {
        return Math.max(Math.abs(d[p * 4] - br), Math.abs(d[p * 4 + 1] - bg), Math.abs(d[p * 4 + 2] - bb));
      };
      var gone = new Uint8Array(w * h);
      var q = new Int32Array(w * h);
      var qh = 0, qt = 0;
      var push = function (p) { if (!gone[p] && dist(p) < T) { gone[p] = 1; q[qt++] = p; } };
      for (x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (qh < qt) {
        var p = q[qh++];
        var px = p % w;
        if (px > 0) push(p - 1);
        if (px < w - 1) push(p + 1);
        if (p >= w) push(p - w);
        if (p < w * (h - 1)) push(p + w);
      }
      for (p = 0; p < w * h; p++) {
        var i4 = p * 4;
        if (gone[p]) {
          d[i4] = d[i4 + 1] = d[i4 + 2] = 255;
          continue;
        }
        px = p % w;
        var edge = (px > 0 && gone[p - 1]) || (px < w - 1 && gone[p + 1]) || (p >= w && gone[p - w]) || (p < w * (h - 1) && gone[p + w]);
        if (!edge) continue;
        var a = clamp((dist(p) - T) / (T * 1.4), 0, 1);
        d[i4] = Math.round(d[i4] * a + 255 * (1 - a));
        d[i4 + 1] = Math.round(d[i4 + 1] * a + 255 * (1 - a));
        d[i4 + 2] = Math.round(d[i4 + 2] * a + 255 * (1 - a));
      }
      ctx.putImageData(data, 0, 0);
    }

    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var j = (y * w + x) * 4;
        if (Math.min(d[j], d[j + 1], d[j + 2]) < 236) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
    var bw = x1 - x0 + 1;
    var bh = y1 - y0 + 1;
    var pad = Math.round(Math.max(bw, bh) * 0.05);

    // Centre on the figure itself, not its bounding box: a soft grey floor shadow off to one side
    // would otherwise push the doll off-centre. "Body" pixels are dark or coloured; light greys are not.
    var cols = new Float64Array(w);
    var mass = 0;
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        var k4 = (y * w + x) * 4;
        var lo = Math.min(d[k4], d[k4 + 1], d[k4 + 2]);
        var hi = Math.max(d[k4], d[k4 + 1], d[k4 + 2]);
        if (lo < 170 || hi - lo > 40) { cols[x]++; mass++; }
      }
    }
    var mid = x0 + bw / 2;
    if (mass) {
      for (x = x0, n = 0; x <= x1; x++) {
        n += cols[x];
        if (n >= mass / 2) { mid = x + 0.5; break; }
      }
    }
    var half = Math.max(mid - x0, x1 + 1 - mid) + pad;
    // keep at least a 3:4 box so very wide or very tall results don't look cramped
    var cw = Math.max(half * 2, (bh + pad * 2) * 0.62);
    var ch = Math.max(bh + pad * 2, cw * 0.9);
    var cx = mid - cw / 2;
    var cy = y0 + bh + pad - ch;

    function render(maxH, maxW, quality) {
      var s = Math.min(maxH / ch, maxW / cw, 1.6);
      var out = canvas(Math.round(cw * s), Math.round(ch * s));
      var o = out.getContext('2d');
      o.fillStyle = '#fff';
      o.fillRect(0, 0, out.width, out.height);
      o.imageSmoothingQuality = 'high';
      // whole image at an offset: older Safari draws nothing when a source rect leaves the image
      o.drawImage(c, -cx * s, -cy * s, w * s, h * s);
      return out.toDataURL('image/jpeg', quality);
    }
    return { jpg: render(760, 640, 0.9), thumb: render(300, 260, 0.86) };
  }

  /* ---------- generate ---------- */

  var tipTimer = null;
  function showLoading(on) {
    loading.hidden = !on;
    frame.classList.toggle('is-busy', on);
    goBtn.disabled = on;
    clearInterval(tipTimer);
    if (!on) return;
    var i = 0;
    var t0 = Date.now();
    var tip = $('feltTip');
    var bar = $('feltBar');
    tip.textContent = TIPS[0];
    bar.style.width = '4%';
    tipTimer = setInterval(function () {
      var t = (Date.now() - t0) / 1000;
      bar.style.width = Math.round(4 + 90 * (1 - Math.exp(-t / 14))) + '%';
      if (Math.floor(t / 2.4) !== i) {
        i = Math.floor(t / 2.4);
        tip.textContent = TIPS[i % TIPS.length];
      }
    }, 300);
  }

  function generate() {
    if (busy) return;
    if (!photo) { pick(); return; }
    if (aiOk === false) {
      showError(errorEl, '毛毡生成服务暂时连不上，请稍后再试');
      return;
    }
    showError(errorEl, '');
    var ctrl = window.AbortController ? new AbortController() : null;
    var job = busy = { ctrl: ctrl };
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
    showLoading(true);
    var body;
    try { body = JSON.stringify({ image: framedJpeg() }); } catch (e) {
      busy = null;
      clearTimeout(timer);
      showLoading(false);
      showError(errorEl, '这张照片处理不了，换一张试试');
      return;
    }
    P.json('api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (j) {
      if (!j.image) throw new Error('AI 没有返回图片，再试一次吧');
      return loadImg(j.image).then(function (im) { return { im: im, ticket: j.ticket }; });
    }).then(function (r) {
      if (busy !== job) return;
      var out = tidy(r.im);
      result = { jpg: out.jpg, thumb: out.thumb, ticket: r.ticket };
      $('feltResult').src = out.jpg;
      var me = P.me();
      if (!nick.value && me && me.nickname) nick.value = me.nickname;
      showError(postError, '');
      step('result');
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) {
      if (busy !== job) return;
      showError(errorEl, netMessage(e) + (photo ? '（照片还在，可以直接再点生成）' : ''));
    }).then(function () {
      clearTimeout(timer);
      if (busy === job) {
        busy = null;
        showLoading(false);
      }
    });
  }

  $('feltCancel').addEventListener('click', function (e) {
    e.stopPropagation();
    if (!busy) return;
    if (busy.ctrl) busy.ctrl.abort();
    busy = null;
    showLoading(false);
  });
  // the cancel chip sits inside the frame; keep its taps from reaching the drag / picker handlers
  $('feltCancel').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  goBtn.addEventListener('click', generate);
  $('feltRetry').addEventListener('click', function () {
    step('photo');
    generate();
  });
  $('feltRepick').addEventListener('click', function () {
    result = null;
    step('photo');
    pick();
  });

  /* ---------- post to the gallery ---------- */

  function setPosting(on) {
    postBtn.disabled = on;
    postBtn.querySelector('span').textContent = on ? '正在放进集合页…' : '放进集合页';
  }

  postBtn.addEventListener('click', function () {
    if (!result || postBtn.disabled) return;
    var me = P.me();
    setPosting(true);
    showError(postError, '');
    P.json('api/wall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jpg: result.jpg,
        thumb: result.thumb,
        ticket: result.ticket,
        nickname: nick.value.trim(),
        replace: me && me.key ? { id: me.id, key: me.key } : null
      })
    }).then(function (j) {
      var item = j.item;
      item.key = j.key;
      result = null;
      P.setMe(item);
      P.toast('已入列！你是第 ' + item.no + ' 位毛毡开发者');
      loadCrowd();
    }).catch(function (e) {
      showError(postError, netMessage(e));
    }).then(function () {
      setPosting(false);
    });
  });

  function renderDone() {
    var me = P.me();
    if (!me) return;
    $('feltMine').src = me.url;
    $('feltNo').textContent = 'No.' + ('00' + me.no).slice(-3);
    $('feltDoneSub').textContent = me.nickname + ' · 第 ' + me.no + ' 位入列';
    step('done');
  }

  $('feltAgain').addEventListener('click', function () {
    result = null;
    step('photo');
    if (!photo) pick();
  });

  $('feltRemove').addEventListener('click', function () {
    var me = P.me();
    if (!me || !window.confirm('确定把你的毛毡形象从集合页移除吗？')) return;
    P.json('api/wall/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: me.id, key: me.key })
    }).then(function () {
      P.setMe(null);
      P.toast('已从集合页移除');
      loadCrowd();
    }, function (e) {
      if (e.status === 403) {
        P.setMe(null);
        loadCrowd();
      } else {
        P.toast(netMessage(e));
      }
    });
  });

  document.addEventListener('plush:me', function () {
    if (P.me()) renderDone();
    else step('photo');
  });

  /* ---------- gallery preview ---------- */

  var crowd = $('feltCrowd');
  function loadCrowd() {
    P.json('api/wall?limit=9').then(function (j) {
      var row = $('feltCrowdRow');
      row.innerHTML = '';
      (j.items || []).forEach(function (it) {
        var img = document.createElement('img');
        img.src = it.thumb;
        img.alt = it.nickname;
        img.loading = 'lazy';
        row.appendChild(img);
      });
      $('feltCount').textContent = j.total;
      crowd.hidden = !j.total;
    }).catch(function () {});
  }

  /* ---------- start ---------- */

  P.json('api/config').then(function (j) {
    aiOk = !!j.ai;
    if (!aiOk) showError(errorEl, '毛毡生成服务还没开通，稍后再来试试');
  }, function () {
    aiOk = false;
    showError(errorEl, '当前页面连不上毛毡生成服务，请在正式活动页 wechat.tokenmap.com.cn/1030 里使用');
  });

  var me = P.me();
  if (me) {
    renderDone();
    // the organiser may have removed it from the gallery; forget it so the visitor can make a new one
    P.json('api/wall/' + me.id).catch(function (e) {
      if (e.status === 404) P.setMe(null);
    });
  }
  loadCrowd();
})();
