(function () {
  'use strict';

  var W = 750;
  var H = 1480;
  var SCALE = 2;
  var QR_LIB = 'js/vendor/qrcode.js';

  var C = {
    ink: '#3d2e5c',
    ink2: '#6f6491',
    berry: '#f2668b',
    blue: '#a0d8fb',
    page: '#fff5ee',
    white: '#ffffff',
    sky: '#d3edfd',
    pink: '#ffdfe7',
    lemon: '#fff0b5',
    mint: '#d4f4e4',
    lilac: '#e7dfff',
    peach: '#ffe2d1'
  };
  var DISPLAY = '"PlushDisplay", "PingFang SC", "Microsoft YaHei", sans-serif';
  var NUM = '"PlushNum", "PlushDisplay", "PingFang SC", sans-serif';
  var BODY = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

  // Every poster, from any page, leads to the event details page.
  function shareUrl() {
    var link = document.querySelector('link[rel="canonical"]');
    var base = link && link.href ? link.href : location.href.split('#')[0].split('?')[0];
    return new URL('./', base).href;
  }

  function currentMe() {
    return window.Plush ? window.Plush.me() : null;
  }

  function wallTotal() {
    if (!window.fetch) return Promise.resolve(0);
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(0); }, 2500); });
    var req = fetch('api/config').then(function (r) { return r.json(); }).then(function (j) { return +j.total || 0; }, function () { return 0; });
    return Promise.race([req, timeout]);
  }

  function pad3(n) {
    return ('00' + n).slice(-3);
  }

  // Deterministic randomness keeps the fuzz identical every time the poster is drawn.
  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.qrcode) return resolve();
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('无法加载二维码组件')); };
      document.head.appendChild(s);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片加载失败：' + src)); };
      img.src = src;
    });
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var loads = Promise.all([
      document.fonts.load('400 40px "PlushDisplay"', '开发者召集令'),
      document.fonts.load('900 40px "PlushNum"', '0123456789¥')
    ]).catch(function () {});
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 2500); });
    return Promise.race([loads, timeout]);
  }

  /* ---------- geometry ---------- */

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function rectPoints(x, y, w, h, r, step) {
    var pts = [];
    r = Math.min(r, w / 2, h / 2);
    function line(x0, y0, x1, y1, nx, ny) {
      var n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
      for (var i = 0; i < n; i++) {
        var t = i / n;
        pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny]);
      }
    }
    function arc(cx, cy, a0, a1) {
      var n = Math.max(1, Math.round((r * Math.abs(a1 - a0)) / step));
      for (var i = 0; i < n; i++) {
        var a = a0 + ((a1 - a0) * i) / n;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
      }
    }
    var P = Math.PI;
    line(x + r, y, x + w - r, y, 0, -1);
    arc(x + w - r, y + r, -P / 2, 0);
    line(x + w, y + r, x + w, y + h - r, 1, 0);
    arc(x + w - r, y + h - r, 0, P / 2);
    line(x + w - r, y + h, x + r, y + h, 0, 1);
    arc(x + r, y + h - r, P / 2, P);
    line(x, y + h - r, x, y + r, -1, 0);
    arc(x + r, y + r, P, P * 1.5);
    return pts;
  }

  function circlePoints(cx, cy, r, step) {
    var pts = [];
    var n = Math.max(12, Math.round((2 * Math.PI * r) / step));
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
    return pts;
  }

  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function mix(a, b, t) {
    var x = hexToRgb(a);
    var y = hexToRgb(b);
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); }).join(',') + ')';
  }

  /* ---------- plush primitives ---------- */

  // Short strokes poking out of an edge read as chenille fibres.
  function hairs(ctx, pts, color, rand, len) {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    var single = typeof color === 'string';
    if (single) {
      ctx.strokeStyle = color;
      ctx.beginPath();
    }
    pts.forEach(function (p) {
      var a = Math.atan2(p[3], p[2]) + (rand() - 0.5) * 1.5;
      var l = len * (0.45 + rand() * 0.8);
      var sx = p[0] - p[2] * 1.5;
      var sy = p[1] - p[3] * 1.5;
      if (!single) {
        ctx.strokeStyle = color(p);
        ctx.beginPath();
      }
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l);
      if (!single) ctx.stroke();
    });
    if (single) ctx.stroke();
    ctx.restore();
  }

  function fibres(ctx, rand, count, x, y, w, h) {
    for (var i = 0; i < count; i++) {
      ctx.fillStyle = rand() > 0.45 ? 'rgba(255,255,255,.34)' : 'rgba(80,40,120,.04)';
      ctx.fillRect(x + rand() * w, y + rand() * h, 1.6, 1.6);
    }
  }

  function plushRect(ctx, x, y, w, h, r, fill, rand, opt) {
    opt = opt || {};
    var flat = typeof fill === 'string' ? fill : null;
    ctx.save();
    ctx.shadowColor = opt.shadow || 'rgba(90,60,150,.26)';
    ctx.shadowBlur = opt.blur || 30;
    ctx.shadowOffsetY = opt.offset == null ? 14 : opt.offset;
    roundRect(ctx, x, y, w, h, r);
    if (flat) {
      ctx.fillStyle = flat;
    } else {
      var g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, fill[0]);
      g.addColorStop(1, fill[1]);
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.restore();

    hairs(ctx, rectPoints(x, y, w, h, r, 2.2), flat || function (p) { return mix(fill[0], fill[1], (p[0] - x) / w); }, rand, opt.hair || 4.6);

    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    var hl = ctx.createRadialGradient(x + w * 0.28, y, 0, x + w * 0.28, y, Math.max(w, h) * 0.85);
    hl.addColorStop(0, 'rgba(255,255,255,.62)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(x, y, w, h);
    var shade = ctx.createLinearGradient(0, y + h - 34, 0, y + h);
    shade.addColorStop(0, 'rgba(80,40,120,0)');
    shade.addColorStop(1, 'rgba(80,40,120,.07)');
    ctx.fillStyle = shade;
    ctx.fillRect(x, y + h - 34, w, 34);
    fibres(ctx, rand, Math.round((w * h) / 90), x, y, w, h);
    ctx.restore();

    if (opt.seam) {
      ctx.save();
      ctx.setLineDash([9, 7]);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = opt.seam;
      roundRect(ctx, x + 9, y + 9, w - 18, h - 18, Math.max(r - 9, 4));
      ctx.stroke();
      ctx.restore();
    }
  }

  function plushCircle(ctx, cx, cy, r, fill, rand) {
    ctx.save();
    ctx.shadowColor = 'rgba(40,90,160,.32)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    hairs(ctx, circlePoints(cx, cy, r, 2.1), fill, rand, 4.6);
    ctx.save();
    var hl = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, 0, cx - r * 0.3, cy - r * 0.4, r * 1.1);
    hl.addColorStop(0, 'rgba(255,255,255,.7)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Several overlapping circles with fibres only on the outer silhouette.
  function blobs(ctx, circles, fill, rand, keep) {
    ctx.fillStyle = fill;
    circles.forEach(function (c) {
      ctx.beginPath();
      ctx.arc(c[0], c[1], c[2], 0, Math.PI * 2);
      ctx.fill();
    });
    var pts = [];
    circles.forEach(function (c, i) {
      circlePoints(c[0], c[1], c[2], 2.2).forEach(function (p) {
        var inside = circles.some(function (o, j) {
          return j !== i && Math.hypot(p[0] - o[0], p[1] - o[1]) < o[2] - 0.5;
        });
        if (!inside && (!keep || keep(p))) pts.push(p);
      });
    });
    hairs(ctx, pts, fill, rand, 4.4);
  }

  /* ---------- text ---------- */

  // segments: [{t, font, color, mark}] drawn on one baseline.
  function rich(ctx, segs, x, y, align) {
    var widths = segs.map(function (s) {
      ctx.font = s.font;
      return ctx.measureText(s.t).width;
    });
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    var cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    segs.forEach(function (s, i) {
      ctx.font = s.font;
      if (s.mark) {
        ctx.fillStyle = s.mark;
        ctx.fillRect(cursor - 2, y - 9, widths[i] + 4, 12);
      }
      ctx.fillStyle = s.color || C.ink;
      ctx.fillText(s.t, cursor, y);
      cursor += widths[i];
    });
    ctx.restore();
    return total;
  }

  function puffWord(ctx, text, cx, baseline, size, deg, face, layers, glow) {
    ctx.save();
    ctx.translate(cx, baseline);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.font = '400 ' + size + 'px ' + DISPLAY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    var step = size / 62;
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = layers[layers.length - 1];
    ctx.fillText(text, 0, layers.length * step);
    ctx.restore();
    for (var i = layers.length; i >= 1; i--) {
      ctx.fillStyle = layers[i - 1];
      ctx.fillText(text, 0, i * step);
    }
    ctx.fillStyle = face;
    ctx.fillText(text, 0, 0);
    // A dotted rim of the face colour softens the glyph edges like felt.
    ctx.setLineDash([1.2, 2.6]);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = face;
    ctx.strokeText(text, 0, 0);
    ctx.restore();
  }

  function pill(ctx, x, y, h, text, opt, rand) {
    ctx.font = opt.font;
    var pad = opt.pad || 22;
    var dot = opt.dot ? 18 : 0;
    var w = ctx.measureText(text).width + pad * 2 + dot;
    var left = opt.align === 'center' ? x - w / 2 : opt.align === 'right' ? x - w : x;
    plushRect(ctx, left, y, w, h, h / 2, opt.bg, rand, { shadow: opt.shadow || 'rgba(40,90,150,.3)', blur: 16, offset: 8, hair: 3.4 });
    if (opt.dot) {
      ctx.fillStyle = 'rgba(255,122,114,.25)';
      ctx.beginPath();
      ctx.arc(left + pad + 5, y + h / 2, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff7a72';
      ctx.beginPath();
      ctx.arc(left + pad + 5, y + h / 2, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.font = opt.font;
    ctx.fillStyle = opt.color || C.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + pad + dot, y + h / 2 + (opt.nudge || 1));
    ctx.restore();
    return w;
  }

  function sticker(ctx, cx, cy, r, fill, deg, lines, rand) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((deg * Math.PI) / 180);
    plushCircle(ctx, 0, 0, r, fill, rand);
    var total = lines.reduce(function (a, l) { return a + l.lh; }, 0);
    var y = -total / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach(function (l) {
      ctx.font = l.font;
      ctx.fillStyle = l.color || C.ink;
      ctx.fillText(l.t, 0, y + l.lh / 2);
      y += l.lh;
    });
    ctx.restore();
  }

  /* ---------- QR ---------- */

  function drawQR(ctx, text, x, y, size, logo) {
    // Q leaves room for the centre logo while keeping modules large enough
    // to survive WeChat's recompression when the poster is forwarded.
    var qr = window.qrcode(0, 'Q');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    // Snap modules to whole device pixels so scanners see crisp edges.
    var cell = Math.floor((size * SCALE) / n) / SCALE;
    var offset = (size - cell * n) / 2;
    ctx.fillStyle = '#2b2142';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(x + offset + c * cell, y + offset + r * cell, cell, cell);
      }
    }
    if (logo) {
      var ls = size * 0.17;
      var lx = x + (size - ls) / 2;
      var ly = y + (size - ls) / 2;
      ctx.fillStyle = '#fff';
      roundRect(ctx, lx - 5, ly - 5, ls + 10, ls + 10, 12);
      ctx.fill();
      ctx.save();
      roundRect(ctx, lx, ly, ls, ls, 9);
      ctx.clip();
      ctx.drawImage(logo, lx, ly, ls, ls);
      ctx.restore();
    }
  }

  /* ---------- poster ---------- */

  // Die-cut sticker of the felt avatar: the white ground connected to the image edge is dropped,
  // except for a white rim that follows the outline. A near-white part of the figure that touches
  // the ground (white shoes, a white shirt) stays inside the rim, so loose cut-outs never show holes.
  function dieCut(im, maxH, maxW) {
    var s = Math.min(maxH / im.height, maxW / im.width);
    var rim = 7 * SCALE;
    var m = Math.ceil(rim) + 2;
    var iw = Math.round(im.width * s * SCALE);
    var ih = Math.round(im.height * s * SCALE);
    var cw = iw + m * 2;
    var ch = ih + m * 2;

    var src = document.createElement('canvas');
    src.width = cw;
    src.height = ch;
    var sx = src.getContext('2d', { willReadFrequently: true });
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(im, m, m, iw, ih);
    var d = sx.getImageData(0, 0, cw, ch).data;

    var ground = new Uint8Array(cw * ch);
    var q = new Int32Array(cw * ch);
    var qh = 0;
    var qt = 0;
    function isGround(p) {
      var i = p * 4;
      if (d[i + 3] < 8) return true;
      var lo = Math.min(d[i], d[i + 1], d[i + 2]);
      var hi = Math.max(d[i], d[i + 1], d[i + 2]);
      return lo >= 232 && hi - lo <= 14;
    }
    function push(p) {
      if (!ground[p] && isGround(p)) {
        ground[p] = 1;
        q[qt++] = p;
      }
    }
    var x, y, p;
    for (x = 0; x < cw; x++) { push(x); push((ch - 1) * cw + x); }
    for (y = 0; y < ch; y++) { push(y * cw); push(y * cw + cw - 1); }
    while (qh < qt) {
      p = q[qh++];
      x = p % cw;
      if (x > 0) push(p - 1);
      if (x < cw - 1) push(p + 1);
      if (p >= cw) push(p - cw);
      if (p < cw * (ch - 1)) push(p + cw);
    }

    var sil = document.createElement('canvas');
    sil.width = cw;
    sil.height = ch;
    var silCtx = sil.getContext('2d');
    var shape = silCtx.createImageData(cw, ch);
    for (p = 0; p < cw * ch; p++) {
      if (ground[p]) continue;
      shape.data[p * 4] = shape.data[p * 4 + 1] = shape.data[p * 4 + 2] = shape.data[p * 4 + 3] = 255;
    }
    silCtx.putImageData(shape, 0, 0);

    var out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    var o = out.getContext('2d');
    // grow the silhouette by stamping it around two rings
    for (var ring = 1; ring <= 2; ring++) {
      var r = (rim * ring) / 2;
      var steps = ring * 16;
      for (var a = 0; a < steps; a++) {
        var t = (a / steps) * Math.PI * 2;
        o.drawImage(sil, Math.cos(t) * r, Math.sin(t) * r);
      }
    }
    o.drawImage(sil, 0, 0);
    o.globalCompositeOperation = 'source-atop';
    o.drawImage(src, 0, 0);
    return { canvas: out, w: cw / SCALE, h: ch / SCALE, m: m / SCALE };
  }

  // The plush crane stands behind, a little to the right, so its face, hook and laptop stay visible.
  function drawCraneBehind(ctx, crane) {
    var s = 0.58;
    ctx.drawImage(crane, 30, 240, 840, 840, 150, 406, 840 * s, 840 * s);
  }

  // drawn after the cloud edge, so the doll stands in front of it
  function drawMeSticker(ctx, me) {
    var cut = dieCut(me.img, 340, 300);
    var cx = 180;
    var bottom = 820;
    ctx.save();
    ctx.shadowColor = 'rgba(40,80,150,.4)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 12;
    ctx.drawImage(cut.canvas, cx - cut.w / 2, bottom - cut.h + cut.m, cut.w, cut.h);
    ctx.restore();
    return cx;
  }

  function drawMeName(ctx, me, cx, rand) {
    var no = 'No.' + pad3(me.no);
    var noFont = '900 24px ' + NUM;
    var nameFont = '700 25px ' + BODY;
    ctx.font = noFont;
    var w1 = ctx.measureText(no).width;
    ctx.font = nameFont;
    var w2 = ctx.measureText(me.nickname).width;
    var h = 52;
    var w = 24 + w1 + 12 + w2 + 26;
    var left = Math.max(36, Math.min(W - 36 - w, cx - w / 2));
    var top = 806;
    plushRect(ctx, left, top, w, h, h / 2, '#ffffff', rand, { shadow: 'rgba(90,60,150,.34)', blur: 16, offset: 8, hair: 3.4 });
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = noFont;
    ctx.fillStyle = C.berry;
    ctx.fillText(no, left + 24, top + h / 2 + 1);
    ctx.font = nameFont;
    ctx.fillStyle = C.ink;
    ctx.fillText(me.nickname, left + 24 + w1 + 12, top + h / 2 + 1);
    ctx.restore();
  }

  function drawPoster(assets) {
    var canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    var ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    var rand = rng(20261109);

    ctx.fillStyle = C.page;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(242,102,139,.09)';
    for (var dy = 912; dy < H; dy += 22) {
      for (var dx = 11; dx < W; dx += 22) {
        ctx.beginPath();
        ctx.arc(dx, dy, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = C.blue;
    ctx.fillRect(0, 0, W, 902);

    ctx.globalAlpha = 0.9;
    blobs(ctx, [[18, 262, 30], [62, 240, 40], [108, 266, 28]], '#ffffff', rand);
    blobs(ctx, [[652, 400, 26], [698, 378, 38], [744, 404, 30]], '#ffffff', rand);
    ctx.globalAlpha = 1;

    pill(ctx, 36, 38, 50, '圆方智谷×卫华集团', { font: '600 22px ' + BODY, bg: 'rgba(255,255,255,.92)', dot: true }, rand);
    pill(ctx, W - 36, 38, 50, '场景生态OPC社区', { font: '600 22px ' + BODY, bg: '#fff1a8', align: 'right' }, rand);

    pill(ctx, W / 2, 118, 58, 'AI入企黑客松 · 卫华集团专场', {
      font: '400 29px ' + DISPLAY,
      bg: ['#ff8fae', '#b69bff'],
      color: '#ffffff',
      align: 'center',
      pad: 28,
      shadow: 'rgba(120,60,180,.45)',
      nudge: 2
    }, rand);

    ctx.font = '400 108px ' + DISPLAY;
    var w1 = ctx.measureText('开发者').width;
    var w2 = ctx.measureText('召集令').width;
    var gap = 4;
    var tx = (W - w1 - w2 - gap) / 2;
    puffWord(ctx, '开发者', tx + w1 / 2, 300, 108, -3, '#ffffff',
      ['#ffd9e5', '#ffc8d9', '#fcb7cd', '#f8a7c2', '#f39ab8', '#ee8eaf'], 'rgba(170,70,140,.32)');
    puffWord(ctx, '召集令', tx + w1 + gap + w2 / 2, 304, 108, 2.5, '#ffe47a',
      ['#ffd36d', '#ffc562', '#ffb658', '#fca64f', '#f89746', '#f28a3e'], 'rgba(190,100,40,.32)');

    if (assets.me) {
      rich(ctx, [
        { t: assets.me.nickname, font: '700 27px ' + BODY, mark: '#ffe47a' },
        { t: ' 已入列开发者召集令', font: '500 26px ' + BODY }
      ], W / 2, 362, 'center');
      rich(ctx, [{ t: '两天一夜，一起把AI写进真实工业场景。', font: '500 26px ' + BODY }], W / 2, 402, 'center');
      drawCraneBehind(ctx, assets.crane);
    } else {
      rich(ctx, [
        { t: '在', font: '500 26px ' + BODY },
        { t: '全国第一', font: '700 26px ' + BODY, mark: '#ffe47a' },
        { t: '的起重机制造企业，', font: '500 26px ' + BODY }
      ], W / 2, 362, 'center');
      rich(ctx, [{ t: '用两天一夜，把AI写进真实工业场景。', font: '500 26px ' + BODY }], W / 2, 402, 'center');

      var crane = assets.crane;
      var sx = 30;
      var sy = 170;
      var sw = 840;
      var sh = 790;
      var cw = 484;
      var ch = (cw * sh) / sw;
      var cx = (W - cw) / 2;
      var cy = 420;
      ctx.drawImage(crane, sx, sy, sw, sh, cx, cy, cw, ch);
      var fade = ctx.createLinearGradient(0, cy, 0, cy + 54);
      fade.addColorStop(0, 'rgba(160,216,251,1)');
      fade.addColorStop(1, 'rgba(160,216,251,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(cx - 2, cy - 1, cw + 4, 56);
    }

    if (assets.me) {
      // the doll takes the left side, so the stickers line up along the right edge
      sticker(ctx, 688, 478, 58, '#ffe27a', 10, [
        { t: '总奖金超', font: '700 15px ' + BODY, color: C.ink2, lh: 22 },
        { t: '¥6万', font: '900 32px ' + NUM, color: '#ff6b6b', lh: 36 }
      ], rand);
      sticker(ctx, 698, 628, 50, '#ffc6d6', -8, [
        { t: '包吃', font: '400 23px ' + DISPLAY, lh: 27 },
        { t: '包住', font: '400 23px ' + DISPLAY, lh: 27 }
      ], rand);
      sticker(ctx, 688, 770, 56, '#c4f0da', 6, [
        { t: '路费报销', font: '700 14px ' + BODY, color: C.ink2, lh: 21 },
        { t: '¥200', font: '900 29px ' + NUM, color: '#2f9f74', lh: 33 }
      ], rand);
    } else {
      sticker(ctx, 122, 560, 78, '#ffe27a', -10, [
        { t: '总奖金超', font: '700 19px ' + BODY, color: C.ink2, lh: 28 },
        { t: '¥6万', font: '900 42px ' + NUM, color: '#ff6b6b', lh: 46 }
      ], rand);
      sticker(ctx, 640, 520, 62, '#ffc6d6', 9, [
        { t: '包吃', font: '400 29px ' + DISPLAY, lh: 34 },
        { t: '包住', font: '400 29px ' + DISPLAY, lh: 34 }
      ], rand);
      sticker(ctx, 634, 748, 72, '#c4f0da', -6, [
        { t: '路费报销', font: '700 18px ' + BODY, color: C.ink2, lh: 26 },
        { t: '¥200', font: '900 38px ' + NUM, color: '#2f9f74', lh: 42 }
      ], rand);
    }

    var bumps = [];
    for (var i = 0; i < 10; i++) {
      var odd = i % 2;
      bumps.push([i * 84 - 6, 902 - (odd ? 12 : 0), odd ? 56 : 46]);
    }
    ctx.fillStyle = C.page;
    ctx.fillRect(0, 900, W, 14);
    blobs(ctx, bumps, C.page, rand, function (p) { return p[1] < 900; });
    if (assets.me) drawMeName(ctx, assets.me, drawMeSticker(ctx, assets.me), rand);

    var bx = 36;
    var by = 884;
    var bw = W - 72;
    var bh = 334;
    plushRect(ctx, bx, by, bw, bh, 36, C.white, rand, { seam: 'rgba(242,102,139,.3)' });

    var rows = [
      { label: '时间', tone: C.sky, segs: [
        { t: '2026年11月9日—10日', font: '700 25px ' + BODY },
        { t: ' · 两天一夜（拟定）', font: '500 24px ' + BODY, color: C.ink2 }
      ] },
      { label: '地点', tone: C.lemon, segs: [
        { t: '河南省新乡市长垣市山海大道18号', font: '600 25px ' + BODY }
      ] },
      { label: '奖金', tone: C.pink, segs: [
        { t: '总奖金超 ', font: '600 25px ' + BODY },
        { t: '¥60,000', font: '900 30px ' + NUM, color: '#e85a6b' },
        { t: ' · 入围奖不限名额', font: '500 24px ' + BODY, color: C.ink2 }
      ] },
      { label: '福利', tone: C.mint, segs: [
        { t: '包吃包住 · 每人报销路费 ', font: '600 25px ' + BODY },
        { t: '¥200', font: '900 30px ' + NUM, color: '#2f9f74' }
      ] }
    ];
    var labelX = bx + 30;
    var textX = labelX + 82 + 18;
    rows.forEach(function (row, idx) {
      var ry = by + 40 + idx * 58;
      plushRect(ctx, labelX, ry, 82, 42, 21, row.tone, rand, { shadow: 'rgba(90,60,150,.18)', blur: 10, offset: 4, hair: 3 });
      ctx.save();
      ctx.font = '400 23px ' + DISPLAY;
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label, labelX + 41, ry + 22);
      ctx.restore();
      rich(ctx, row.segs, textX, ry + 30, 'left');
    });

    var tracksY = by + 40 + rows.length * 58;
    plushRect(ctx, labelX, tracksY, 82, 42, 21, C.lilac, rand, { shadow: 'rgba(90,60,150,.18)', blur: 10, offset: 4, hair: 3 });
    ctx.save();
    ctx.font = '400 23px ' + DISPLAY;
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('赛道', labelX + 41, tracksY + 22);
    ctx.restore();
    var chipX = textX;
    var chipTones = [C.peach, C.pink, C.mint, C.sky, C.lilac];
    ['生产制造', '营销获客', '人力行政', '售后办公', '内容创作'].forEach(function (t, k) {
      ctx.font = '400 19px ' + DISPLAY;
      var cwid = ctx.measureText(t).width + 20;
      ctx.fillStyle = chipTones[k];
      roundRect(ctx, chipX, tracksY + 4, cwid, 34, 17);
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(t, chipX + 10, tracksY + 22);
      chipX += cwid + 7;
    });

    var qy = 1242;
    var qh = 212;
    plushRect(ctx, bx, qy, bw, qh, 36, ['#ffd8e3', '#e7dcff'], rand, { seam: 'rgba(255,255,255,.95)' });
    var tile = 184;
    var tileX = bx + bw - 14 - tile - 10;
    var tileY = qy + (qh - tile) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(90,60,150,.3)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff';
    roundRect(ctx, tileX, tileY, tile, tile, 20);
    ctx.fill();
    ctx.restore();
    drawQR(ctx, assets.url, tileX + 12, tileY + 12, tile - 24, assets.logo);

    rich(ctx, [{ t: '长按识别二维码', font: '400 36px ' + DISPLAY }], bx + 34, qy + 78, 'left');
    var invite = assets.me && assets.total > 1
      ? '已有 ' + assets.total + ' 位开发者入列，等你来'
      : '查看活动详情 · 立即报名';
    rich(ctx, [{ t: invite, font: '700 23px ' + BODY, color: C.berry }], bx + 34, qy + 122, 'left');
    rich(ctx, [{ t: '主办：圆方智谷×卫华集团', font: '500 19px ' + BODY, color: C.ink2 }], bx + 34, qy + 162, 'left');

    ctx.save();
    ctx.translate(tileX - 30, qy + qh / 2);
    ctx.strokeStyle = C.berry;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var a = 0; a < 2; a++) {
      ctx.globalAlpha = a ? 1 : 0.45;
      ctx.beginPath();
      ctx.moveTo(-7 + a * 12, -10);
      ctx.lineTo(3 + a * 12, 0);
      ctx.lineTo(-7 + a * 12, 10);
      ctx.stroke();
    }
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.92);
  }

  /* ---------- modal ---------- */

  var ua = navigator.userAgent;
  var isWeChat = /MicroMessenger/i.test(ua);
  var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  var cached = null;
  var pending = null;
  var lastFocus = null;

  var modal = document.getElementById('posterModal');
  if (!modal) return;
  var img = modal.querySelector('.poster-img');
  var loading = modal.querySelector('.poster-loading');
  var errorBox = modal.querySelector('.poster-error');
  var tip = modal.querySelector('.poster-tip');
  var saveBtn = document.getElementById('posterSave');
  var shareBtn = document.getElementById('posterShare');
  var closeBtn = modal.querySelector('.poster-close');

  tip.textContent = isWeChat
    ? '长按海报，保存到相册或发送给朋友'
    : isMobile ? '长按海报可保存，或点击下方按钮' : '点击下方按钮保存海报';
  if (isWeChat) saveBtn.hidden = true;
  var upsell = modal.querySelector('.poster-upsell');

  function posterKey(me) {
    return me ? me.id + '|' + me.nickname : 'generic';
  }

  // cached / pending are keyed by the avatar, so making a new one redraws the poster
  function generate() {
    var me = currentMe();
    var key = posterKey(me);
    if (cached && cached.key === key) return Promise.resolve(cached.url);
    if (pending && pending.key === key) return pending.promise;
    var avatar = me
      ? loadImage(me.url).catch(function () { return null; })
      : Promise.resolve(null);
    var job = { key: key };
    job.promise = Promise.all([
      loadScript(QR_LIB),
      loadImage('assets/img/hero-crane.webp'),
      loadImage('assets/img/ic-factory.webp'),
      fontsReady(),
      avatar,
      me ? wallTotal() : 0
    ]).then(function (r) {
      // a missing avatar (removed from the gallery) falls back to the generic poster
      var withMe = me && r[4];
      return drawPoster({
        crane: r[1],
        logo: r[2],
        url: shareUrl(),
        me: withMe ? { img: r[4], nickname: me.nickname, no: me.no } : null,
        total: r[5]
      });
    }).then(function (url) {
      if (pending === job) pending = null;
      cached = { key: key, url: url };
      return url;
    }, function (err) {
      if (pending === job) pending = null;
      throw err;
    });
    pending = job;
    return job.promise;
  }

  function setState(state) {
    loading.hidden = state !== 'loading';
    errorBox.hidden = state !== 'error';
    img.hidden = state !== 'ready';
    saveBtn.classList.toggle('is-disabled', state !== 'ready');
  }

  function show(url) {
    img.src = url;
    saveBtn.href = url;
    setState('ready');
    if (shareBtn && !isWeChat && navigator.canShare && window.File) {
      dataUrlToFile(url).then(function (file) {
        if (navigator.canShare({ files: [file] })) {
          shareBtn.hidden = false;
          shareBtn.onclick = function () {
            navigator.share({ files: [file], title: '开发者召集令 · AI入企黑客松' }).catch(function () {});
          };
        }
      }).catch(function () {});
    }
  }

  function dataUrlToFile(url) {
    return fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
      return new File([blob], '卫华AI黑客松-分享海报.jpg', { type: 'image/jpeg' });
    });
  }

  function open() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.documentElement.classList.add('poster-open');
    closeBtn.focus({ preventScroll: true });
    var me = currentMe();
    if (upsell) upsell.hidden = !!me;
    setState(cached && cached.key === posterKey(me) ? 'ready' : 'loading');
    // Let the loading state paint before the synchronous canvas work starts.
    setTimeout(function () {
      generate().then(show, function () { setState('error'); });
    }, 60);
  }

  function close() {
    modal.hidden = true;
    document.documentElement.classList.remove('poster-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-poster]')) {
      e.preventDefault();
      open();
    } else if (e.target.closest('[data-poster-close]')) {
      close();
    } else if (e.target.closest('[data-poster-retry]')) {
      open();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
  saveBtn.addEventListener('click', function (e) {
    if (saveBtn.classList.contains('is-disabled')) e.preventDefault();
  });
})();
