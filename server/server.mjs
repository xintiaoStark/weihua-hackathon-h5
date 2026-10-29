// AI入企黑客松 · 卫华集团专场：毛毡形象生成 + 集合页 API
//   node server.mjs   -> http://127.0.0.1:3030
// 配置写在同目录 .env（参考 .env.example）。线上由 Nginx 提供静态页面，只把 /1030/api/ 和 /1030/avatars/ 转发到这里。
import http from 'node:http';
import { readFile, writeFile, rename, mkdir, unlink, stat } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));
const env = process.env;

const PORT = +env.PORT || 3030;
const PREFIX = (env.PREFIX ?? '/1030').replace(/\/+$/, '');
const DATA = path.resolve(ROOT, env.DATA_DIR || 'data');
const AVATARS = path.join(DATA, 'avatars');
const THUMBS = path.join(AVATARS, 's');
const WALL_FILE = path.join(DATA, 'wall.json');
// local preview only: serve the static page too, so one process covers everything
const STATIC = env.STATIC_DIR ? path.resolve(ROOT, env.STATIC_DIR) : null;
const PROVIDER = (env.AI_PROVIDER || (env.ARK_API_KEY ? 'ark' : 'none')).toLowerCase();
const GEN_PER_HOUR = +env.GEN_PER_HOUR || 20;   // per visitor IP; venue Wi-Fi puts many phones behind one IP
const GEN_PER_DAY = +env.GEN_PER_DAY || 1000;   // whole site, caps AI spend
const POST_PER_HOUR = +env.POST_PER_HOUR || 12;
const DEFAULT_NAME = '神秘开发者';

await mkdir(THUMBS, { recursive: true });

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// ---------------- wall store ----------------
let wall = [];
try { wall = JSON.parse(readFileSync(WALL_FILE, 'utf8')); } catch {}
let nextNo = wall.reduce((m, w) => Math.max(m, w.no), 0) + 1;
let saving = Promise.resolve();
const persist = () => (saving = saving.then(async () => {
  const tmp = WALL_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(wall));
  await rename(tmp, WALL_FILE);
}).catch(e => console.error('保存失败', e)));
const pub = w => ({ id: w.id, no: w.no, nickname: w.nickname, url: `avatars/${w.id}.jpg`, thumb: `avatars/s/${w.id}.jpg`, ts: w.ts });
const hashKey = k => crypto.createHash('sha256').update(String(k || '')).digest('hex');
const cleanText = (s, max) => [...String(s || '').replace(/[\u0000-\u001f\u007f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
const isAdmin = req => !!env.ADMIN_TOKEN && req.headers['x-admin-token'] === env.ADMIN_TOKEN;

async function removeFiles(id) {
  await unlink(path.join(AVATARS, id + '.jpg')).catch(() => {});
  await unlink(path.join(THUMBS, id + '.jpg')).catch(() => {});
}

// ---------------- rate limits ----------------
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr); return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) if (!arr.some(t => now - t < 3600e3)) hits.delete(k);
}, 600e3).unref();
let dayKey = '', dayCount = 0;
function dailyCapHit() {
  const k = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);   // reset at Beijing midnight
  if (k !== dayKey) { dayKey = k; dayCount = 0; }
  return dayCount >= GEN_PER_DAY;
}

// A wall post needs a ticket from a finished generation, so the gallery can't be filled by
// scripting uploads alone. Tickets are single-use and expire.
const tickets = new Map();
const TICKET_TTL = 40 * 60e3;
function issueTicket() {
  const now = Date.now();
  for (const [t, exp] of tickets) if (exp < now) tickets.delete(t);
  const t = crypto.randomBytes(12).toString('hex');
  tickets.set(t, now + TICKET_TTL);
  return t;
}
function useTicket(t) {
  const exp = tickets.get(t);
  if (!exp) return false;
  tickets.delete(t);
  return exp >= Date.now();
}

// ---------------- AI felt doll ----------------
const STYLE = '把参考照片中的人物做成一个手工羊毛毡（戳戳乐）Q 版玩偶：大头小身子的 2 头身比例，圆圆的脸、圆亮的大眼睛和淡淡的腮红，'
  + '造型圆润饱满、可爱治愈，全身由蓬松细腻的羊毛纤维戳制而成，表面是清晰的毛毡绒毛质感，轮廓边缘带柔软细小的绒毛，'
  + '配色明快柔和（马卡龙粉彩），柔和均匀的棚拍光，像一张真实手工毛毡公仔的产品照。';
const ORIGINAL = '这是照片里这个人自己的原创形象，不要画成或模仿任何已有的动漫、游戏、电影角色或品牌吉祥物。';
const KEEP = '保留人物可辨认的特征：发型、发色、脸型、肤色、是否戴眼镜、胡子、服装款式和颜色。表情开心友好。'
  + '只做一个角色，正面站姿，一只手比出胜利手势，完整全身，头顶和脚底都完整可见，四周留出空白。';
const STRICT = '衣服和配饰上不要出现任何 logo、商标、卡通图案或文字，用纯色代替。';
const BG_WHITE = '背景必须是纯白色（#FFFFFF）纯色背景，角色脚下也不要有影子，不要场景、地面、底座、投影、文字、边框或水印。';
const prompt = strict => STYLE + ORIGINAL + KEEP + (strict ? STRICT : '') + BG_WHITE;
const isCopyright = msg => /copyright|版权|intellectual/i.test(msg || '');
const toDataUrl = b64 => `data:image/${b64.startsWith('iVBOR') ? 'png' : b64.startsWith('UklG') ? 'webp' : 'jpeg'};base64,${b64}`;

async function generate(dataUrl) {
  if (PROVIDER === 'mock') {
    await new Promise(r => setTimeout(r, +env.MOCK_DELAY || 1500));
    const file = path.resolve(ROOT, env.MOCK_IMAGE || 'mock_avatar.png');
    return toDataUrl((await readFile(file)).toString('base64'));
  }
  if (PROVIDER !== 'ark') throw new Error('还没有配置 AI 生成服务');
  const t0 = Date.now();
  const call = async (size, strict) => {
    const res = await fetch(`${env.ARK_BASE || 'https://ark.cn-beijing.volces.com/api/v3'}/images/generations`, {
      method: 'POST', signal: AbortSignal.timeout(+env.ARK_TIMEOUT || 65000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ARK_API_KEY}` },
      body: JSON.stringify({
        model: env.ARK_MODEL || 'doubao-seedream-5-0-flash-260915', prompt: prompt(strict), image: dataUrl,
        size, response_format: 'b64_json', watermark: false, stream: false,
      }),
    });
    return { res, j: await res.json().catch(() => ({})) };
  };
  let size = env.ARK_SIZE || '1K';
  let { res, j } = await call(size);
  // some Seedream versions reject the 1K tier; retry once at 2K instead of failing the visitor
  if (!res.ok && size !== '2K' && /size/i.test(j?.error?.message || '')) ({ res, j } = await call(size = '2K'));
  // the copyright check judges the output, which differs every time: one quiet retry with plain clothes usually
  // passes. Skipped when the first try was slow so the phone still gets an answer before it gives up.
  if (!res.ok && isCopyright(j?.error?.message) && Date.now() - t0 < 30000) {
    console.log('[generate] 版权审核未过，自动重试一次');
    dayCount++;
    ({ res, j } = await call(size, true));
  }
  const b64 = j?.data?.[0]?.b64_json;
  if (!res.ok || !b64) throw new Error(j?.error?.message || `火山方舟返回 ${res.status}`);
  return toDataUrl(b64);
}

// ---------------- http helpers ----------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
// behind Nginx the port only listens on 127.0.0.1, so X-Forwarded-For always comes from our own proxy
const ipOf = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

function readJson(req, limit) {
  return new Promise((ok, bad) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { bad(Object.assign(new Error('图片太大了'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { bad(Object.assign(new Error('请求格式不对'), { code: 400 })); } });
    req.on('error', bad);
  });
}
function decodeImage(dataUrl, kinds) {
  const m = /^data:image\/([a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m || !kinds.includes(m[1])) return null;
  const buf = Buffer.from(m[2], 'base64');
  const isPng = buf[0] === 0x89 && buf[1] === 0x50, isJpg = buf[0] === 0xff && buf[1] === 0xd8, isWebp = buf.slice(8, 12).toString() === 'WEBP';
  return (m[1] === 'png' && isPng) || (m[1] === 'jpeg' && isJpg) || (m[1] === 'webp' && isWebp) ? buf : null;
}

async function serveFile(res, base, rel, cache) {
  const file = path.normalize(path.join(base, rel));
  if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  let st; try { st = await stat(file); } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
  if (st.isDirectory()) return serveFile(res, base, path.join(rel, 'index.html'), cache);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
  createReadStream(file).pipe(res);
}

function generateError(msg) {
  if (isCopyright(msg)) return '画出来的形象没通过版权审核（衣服上的卡通图案、logo 容易触发），换一张照片试试';
  if (/sensitive|risk|审核|敏感|inappropriate/i.test(msg)) return '这张照片没通过 AI 审核，换一张试试';
  if (/timeout|aborted/i.test(msg)) return 'AI 这会儿有点忙，稍后再试';
  return 'AI 开小差了，稍后再试';
}

// ---------------- routes ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (PREFIX && (p === PREFIX || p.startsWith(PREFIX + '/'))) p = p.slice(PREFIX.length) || '/';
  let m;
  try {
    if (p === '/api/config' && req.method === 'GET')
      return send(res, 200, { ai: PROVIDER !== 'none', total: wall.length });

    if (p === '/api/generate' && req.method === 'POST') {
      if (PROVIDER === 'none') return send(res, 503, { error: 'AI 生成暂时没开通' });
      const ip = ipOf(req);
      if (limited('gen:' + ip, GEN_PER_HOUR, 3600e3)) return send(res, 429, { error: '生成太频繁啦，休息一会儿再来' });
      if (dailyCapHit()) return send(res, 429, { error: '今天的 AI 生成名额用完了，明天再来吧' });
      const body = await readJson(req, 4e6);
      if (!decodeImage(body.image, ['jpeg', 'png', 'webp'])) return send(res, 400, { error: '照片格式不支持，换一张试试' });
      dayCount++;
      const t0 = Date.now();
      try {
        const image = await generate(body.image);
        console.log(`[generate] ok ${ip} ${Math.round((Date.now() - t0) / 100) / 10}s`);
        return send(res, 200, { image, ticket: issueTicket() });
      } catch (e) {
        dayCount--;
        console.error('[generate] 失败', ip, e.message);
        return send(res, 502, { error: generateError(e.message) });
      }
    }

    if (p === '/api/wall' && req.method === 'POST') {
      const ip = ipOf(req);
      if (limited('post:' + ip, POST_PER_HOUR, 3600e3)) return send(res, 429, { error: '入列太频繁啦，稍后再试' });
      const body = await readJson(req, 3e6);
      const img = decodeImage(body.jpg, ['jpeg']), th = decodeImage(body.thumb, ['jpeg']);
      if (!img || !th || img.length > 1.5e6 || th.length > 300e3) return send(res, 400, { error: '形象图片不对，重新生成试试' });
      if (!useTicket(String(body.ticket || ''))) return send(res, 403, { error: '这个形象已经入列过了，或者生成太久了，重新生成一次吧' });
      // the owner key lets the same phone swap its avatar later without taking a new number
      const old = body.replace && wall.find(x => x.id === body.replace.id && x.key === hashKey(body.replace.key));
      const key = crypto.randomBytes(12).toString('hex');
      const w = { id: crypto.randomBytes(5).toString('hex'), no: old ? old.no : nextNo++,
        nickname: cleanText(body.nickname, 12) || DEFAULT_NAME, key: hashKey(key), ts: Date.now() };
      await writeFile(path.join(AVATARS, w.id + '.jpg'), img);
      await writeFile(path.join(THUMBS, w.id + '.jpg'), th);
      if (old) { wall.splice(wall.indexOf(old), 1); removeFiles(old.id); }
      wall.push(w); await persist();
      console.log(`[wall] No.${w.no} ${old ? '更新' : '新入列'}`);
      return send(res, 200, { item: pub(w), key, total: wall.length });
    }

    if (p === '/api/wall' && req.method === 'GET') {
      const limit = Math.min(300, Math.max(1, +url.searchParams.get('limit') || 120));
      const before = +url.searchParams.get('before') || Infinity;
      const list = wall.filter(w => w.no < before).sort((a, b) => b.no - a.no).slice(0, limit);
      return send(res, 200, { total: wall.length, items: list.map(pub), more: list.length === limit && list[list.length - 1].no > 1 });
    }

    if ((m = p.match(/^\/api\/wall\/([a-f0-9]{10})$/)) && req.method === 'GET') {
      const w = wall.find(x => x.id === m[1]);
      return w ? send(res, 200, { item: pub(w), total: wall.length }) : send(res, 404, { error: 'not found' });
    }

    if (p === '/api/wall/remove' && req.method === 'POST') {
      const { id, key } = await readJson(req, 1e4);
      const admin = isAdmin(req);
      const i = wall.findIndex(x => x.id === id && (admin || x.key === hashKey(key)));
      if (i < 0) return send(res, admin ? 404 : 403, { error: admin ? '没找到' : '只能移除自己的形象' });
      const [w] = wall.splice(i, 1); await persist();
      await removeFiles(w.id);
      console.log(`[wall] No.${w.no} 已移除${admin ? '（管理员）' : ''}`);
      return send(res, 200, { ok: true, total: wall.length });
    }

    if (p === '/api/admin/check' && req.method === 'GET')
      return isAdmin(req) ? send(res, 200, { ok: true, total: wall.length }) : send(res, 403, { error: '管理口令不对' });

    if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if ((m = p.match(/^\/avatars\/((?:s\/)?[a-f0-9]{10}\.jpg)$/))) return serveFile(res, AVATARS, m[1], 'public, max-age=31536000, immutable');
    if (STATIC) return serveFile(res, STATIC, p === '/' ? 'index.html' : p, 'no-cache');
    res.writeHead(404); res.end();
  } catch (e) {
    if (!res.headersSent) send(res, e.code >= 400 && e.code < 500 ? e.code : 500, { error: e.code === 413 || e.code === 400 ? e.message : '服务器出错了' });
  }
});
server.requestTimeout = 150e3;
server.listen(PORT, ...(env.HOST ? [env.HOST] : []), () => {
  console.log(`毛毡形象服务已启动：http://${env.HOST || 'localhost'}:${PORT}${PREFIX}/`);
  console.log(`AI 生成：${PROVIDER === 'none' ? '未配置（访客无法生成形象）' : PROVIDER}；集合页已有 ${wall.length} 人`);
});
