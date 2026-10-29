(function () {
  'use strict';

  var EVENT_START = new Date('2026-11-09T00:00:00+08:00').getTime();
  var EVENT_END = new Date('2026-11-11T00:00:00+08:00').getTime();
  var DAY = 86400000;

  function countdown() {
    var el = document.getElementById('countdown');
    if (!el) return;
    var now = Date.now();
    if (now < EVENT_START) {
      el.innerHTML = '距开幕 <b>' + Math.ceil((EVENT_START - now) / DAY) + '</b> 天';
      el.hidden = false;
    } else if (now < EVENT_END) {
      el.textContent = '活动进行中';
      el.hidden = false;
    }
  }

  function reveal() {
    var items = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      var batch = 0;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.style.setProperty('--d', (batch++ * 0.07).toFixed(2) + 's');
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });
  }

  function dock() {
    var bar = document.getElementById('dock');
    var heroCta = document.getElementById('heroCta');
    var signup = document.getElementById('signup');
    if (!bar || !heroCta || !signup || !('IntersectionObserver' in window)) return;
    var heroVisible = true;
    var signupVisible = false;
    var controls = bar.querySelectorAll('a, button');
    function update() {
      var show = !heroVisible && !signupVisible;
      bar.classList.toggle('show', show);
      bar.setAttribute('aria-hidden', show ? 'false' : 'true');
      for (var i = 0; i < controls.length; i++) controls[i].tabIndex = show ? 0 : -1;
    }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.target === heroCta) heroVisible = entry.isIntersecting;
        if (entry.target === signup) signupVisible = entry.isIntersecting;
      });
      update();
    }, { threshold: 0 }).observe(heroCta);
    new IntersectionObserver(function (entries) {
      signupVisible = entries[0].isIntersecting;
      update();
    }, { threshold: 0.2 }).observe(signup);
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copy() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-copy]');
      if (!btn) return;
      var text = btn.getAttribute('data-copy');
      var msg = btn.getAttribute('data-toast') || '已复制';
      var fail = function () { toast(legacyCopy(text) ? msg : '复制失败，请长按手动复制'); };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { toast(msg); }, fail);
      } else {
        fail();
      }
    });
  }

  function boing() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-boing], .tile');
      if (!el) return;
      el.classList.remove('boing');
      void el.offsetWidth;
      el.classList.add('boing');
    });
    document.addEventListener('animationend', function (e) {
      if (e.animationName === 'boing') e.target.classList.remove('boing');
    });
  }

  countdown();
  reveal();
  dock();
  copy();
  boing();
})();
