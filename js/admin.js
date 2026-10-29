(function () {
  'use strict';

  var P = window.Plush;
  var grid = document.getElementById('adminGrid');
  if (!grid || !P) return;

  var STORE = 'wh1030_admin';
  var token = '';
  try { token = sessionStorage.getItem(STORE) || ''; } catch (e) {}
  var oldest = Infinity;

  function $(id) { return document.getElementById(id); }
  function pad3(n) { return ('00' + n).slice(-3); }
  function headers() { return { 'Content-Type': 'application/json', 'x-admin-token': token }; }
  function msg(text) {
    $('adminMsg').textContent = text || '';
    $('adminMsg').hidden = !text;
  }

  function card(it) {
    var box = document.createElement('div');
    box.className = 'plush wall-item admin-item tone-white';
    var no = document.createElement('span');
    no.className = 'wall-no n';
    no.textContent = 'No.' + pad3(it.no);
    var pic = document.createElement('a');
    pic.className = 'wall-pic';
    pic.href = it.url;
    pic.target = '_blank';
    pic.rel = 'noopener';
    var img = document.createElement('img');
    img.src = it.thumb;
    img.alt = it.nickname;
    img.loading = 'lazy';
    pic.appendChild(img);
    var name = document.createElement('b');
    name.className = 'wall-name';
    name.textContent = it.nickname;
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'chip-btn';
    del.textContent = '删除';
    del.addEventListener('click', function () {
      if (!window.confirm('删除 No.' + pad3(it.no) + '「' + it.nickname + '」？删除后无法恢复。')) return;
      del.disabled = true;
      P.json('api/wall/remove', { method: 'POST', headers: headers(), body: JSON.stringify({ id: it.id }) }).then(function (j) {
        box.parentNode.removeChild(box);
        $('adminTotal').textContent = '当前共 ' + j.total + ' 人';
        P.toast('已删除');
      }, function (e) {
        del.disabled = false;
        P.toast(e.message);
      });
    });
    box.appendChild(no);
    box.appendChild(pic);
    box.appendChild(name);
    box.appendChild(del);
    return box;
  }

  function load(more) {
    P.json('api/wall?limit=60' + (more ? '&before=' + oldest : '')).then(function (j) {
      $('adminTotal').textContent = '当前共 ' + j.total + ' 人';
      $('adminTotal').hidden = false;
      (j.items || []).forEach(function (it) {
        if (it.no < oldest) oldest = it.no;
        grid.appendChild(card(it));
      });
      $('adminMore').hidden = !j.more;
    }, function (e) { msg(e.message); });
  }

  function enter() {
    msg('');
    P.json('api/admin/check', { headers: headers() }).then(function () {
      try { sessionStorage.setItem(STORE, token); } catch (e) {}
      $('adminForm').hidden = true;
      grid.innerHTML = '';
      oldest = Infinity;
      load(false);
    }, function (e) {
      try { sessionStorage.removeItem(STORE); } catch (err) {}
      msg(e.status === 403 ? '管理口令不对' : e.message);
    });
  }

  $('adminForm').addEventListener('submit', function (e) {
    e.preventDefault();
    token = $('adminToken').value.trim();
    if (token) enter();
  });
  $('adminMore').addEventListener('click', function () { load(true); });
  if (token) enter();
})();
