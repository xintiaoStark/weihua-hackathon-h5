(function () {
  'use strict';

  var P = window.Plush;
  var grid = document.getElementById('wallGrid');
  if (!grid || !P) return;

  var PAGE = 60;
  var TONES = ['#fff4ea', '#eef8ff', '#fff0f4', '#effbf5', '#f4f0ff', '#fffbe6'];
  // centre, left, right: three at most, overlapping figures would multiply into each other
  var SLOTS = [{ x: 50, h: 100, z: 3 }, { x: 19, h: 72, z: 2 }, { x: 81, h: 72, z: 2 }];

  function $(id) { return document.getElementById(id); }
  function pad3(n) { return ('00' + n).slice(-3); }

  var me = P.me();
  var inviteId = (location.search.match(/[?&]u=([a-f0-9]{10})/) || [])[1] || null;
  var inviteItem = null;
  var latest = [];
  var seen = {};
  var newest = 0;
  var oldest = Infinity;

  function setTotal(n) {
    $('wallCount').textContent = n;
    $('wallCountPill').hidden = !n;
  }

  function card(it) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'plush wall-item';
    b.style.setProperty('--bg', TONES[it.no % TONES.length]);
    b.setAttribute('data-id', it.id);
    if (me && me.id === it.id) b.classList.add('is-mine');
    var no = document.createElement('span');
    no.className = 'wall-no n';
    no.textContent = 'No.' + pad3(it.no);
    var pic = document.createElement('span');
    pic.className = 'wall-pic';
    var img = document.createElement('img');
    img.alt = it.nickname + '的毛毡形象';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = it.thumb;
    pic.appendChild(img);
    var name = document.createElement('b');
    name.className = 'wall-name';
    name.textContent = it.nickname;
    b.appendChild(no);
    b.appendChild(pic);
    b.appendChild(name);
    b.addEventListener('click', function () { peek(it); });
    return b;
  }

  function track(it) {
    seen[it.id] = 1;
    if (it.no > newest) newest = it.no;
    if (it.no < oldest) oldest = it.no;
  }

  function load(more) {
    var btn = $('wallMore');
    btn.disabled = true;
    P.json('api/wall?limit=' + PAGE + (more ? '&before=' + oldest : '')).then(function (j) {
      setTotal(j.total);
      (j.items || []).forEach(function (it) {
        if (seen[it.id]) return;
        track(it);
        grid.appendChild(card(it));
      });
      if (!more) {
        latest = (j.items || []).slice(0, 4);
        parade();
      }
      btn.hidden = !j.more;
      $('wallEmpty').hidden = grid.children.length > 0;
      $('wallOffline').hidden = true;
    }).catch(function () {
      if (!grid.children.length) $('wallOffline').hidden = false;
    }).then(function () {
      btn.disabled = false;
    });
  }

  // new arrivals show up without a reload, e.g. on the venue's big screen
  function poll() {
    if (document.hidden) return;
    P.json('api/wall?limit=30').then(function (j) {
      setTotal(j.total);
      var fresh = (j.items || []).filter(function (it) { return !seen[it.id] && it.no > newest; });
      fresh.reverse().forEach(function (it) {
        track(it);
        var c = card(it);
        c.classList.add('is-new');
        grid.insertBefore(c, grid.firstChild);
      });
      if (fresh.length) {
        $('wallEmpty').hidden = true;
        latest = (j.items || []).slice(0, 4);
        parade();
      }
    }).catch(function () {});
  }

  function parade() {
    var box = $('wallParade');
    var ribbon = $('wallRibbon');
    var mine = me && (!inviteItem || inviteItem.id === me.id) ? me : null;
    var lead = inviteItem || mine || latest[0] || null;
    $('wallStageEmpty').hidden = !!lead;
    box.hidden = !lead;
    ribbon.hidden = !lead;
    box.innerHTML = '';
    if (!lead) return;

    var crew = [lead].concat(latest.filter(function (it) { return it.id !== lead.id; })).slice(0, SLOTS.length);
    crew.forEach(function (it, i) {
      var s = SLOTS[i];
      // the slot centres the figure; the image inside runs the pop-in, which animates transform
      var slot = document.createElement('span');
      slot.className = 'wall-slot';
      slot.style.left = s.x + '%';
      slot.style.height = s.h + '%';
      slot.style.zIndex = s.z;
      var img = document.createElement('img');
      img.src = i === 0 ? it.url : it.thumb;
      img.alt = it.nickname + '的毛毡形象';
      img.style.animationDelay = (i * 0.12).toFixed(2) + 's';
      img.addEventListener('click', function () { peek(it); });
      slot.appendChild(img);
      box.appendChild(slot);
    });

    if (inviteItem && !mine) ribbon.textContent = inviteItem.nickname + ' 邀请你加入召集令';
    else if (mine) ribbon.textContent = '我是第 ' + mine.no + ' 位入列的毛毡开发者';
    else ribbon.textContent = '最新入列：' + lead.nickname;
  }

  function syncMine() {
    me = P.me();
    $('wallMake').hidden = !!me;
    $('wallMyPoster').hidden = !me;
    var cards = grid.querySelectorAll('.wall-item');
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('is-mine', !!me && cards[i].getAttribute('data-id') === me.id);
    parade();
  }

  /* ---------- big view ---------- */

  var peekBox = $('peek');
  var lastFocus = null;
  function peek(it) {
    lastFocus = document.activeElement;
    $('peekImg').src = it.url;
    $('peekImg').alt = it.nickname + '的毛毡形象';
    $('peekName').textContent = it.nickname;
    $('peekNo').textContent = 'No.' + pad3(it.no);
    peekBox.hidden = false;
    document.documentElement.classList.add('poster-open');
    peekBox.querySelector('.poster-close').focus({ preventScroll: true });
  }
  function unpeek() {
    peekBox.hidden = true;
    document.documentElement.classList.remove('poster-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-peek-close]')) unpeek();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !peekBox.hidden) unpeek();
  });

  /* ---------- start ---------- */

  $('wallMore').addEventListener('click', function () { load(true); });
  document.addEventListener('plush:me', syncMine);
  syncMine();

  if (me) {
    P.json('api/wall/' + me.id).catch(function (e) {
      if (e.status === 404) P.setMe(null);
    });
  }
  if (inviteId) {
    P.json('api/wall/' + inviteId).then(function (j) {
      inviteItem = j.item;
      parade();
    }).catch(function () {});
  }
  load(false);
  setInterval(poll, 20000);
})();
