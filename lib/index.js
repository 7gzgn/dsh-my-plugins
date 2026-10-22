/**
 * dsh-my-plugins — host half.
 *
 * 回答一个很朴素的问题：我这个 DSH 到底装了什么？
 *
 * 真相源是 **profile 的 package.json**（`dsh.profile.bundles` 决定加载哪些，
 * `dependencies` 给出声明的版本），不是去源码目录里猜。每个插件的一句话
 * 作用取自它自己的 package.json（作者写的），我们不做二次解释。
 *
 * 只读：注册一个无参 GET 接口，60 秒缓存，?force=1 强刷。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const name = 'dsh-my-plugins';

const HERE_DIR = dirname(fileURLToPath(import.meta.url));

const NS = 'dsh-my-plugins';
const CACHE_MS = 60_000;

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** 候选 profile 目录：环境变量优先，其次 profiles/ 下所有。 */
function profileCandidates() {
  const out = [];
  const push = (dir) => {
    if (!dir) return;
    if (!out.includes(dir) && existsSync(join(dir, 'package.json'))) out.push(dir);
  };
  push(process.env.DSH_PROFILE_DIR);
  const root = join(dshHome(), 'profiles');
  try {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory()) push(join(root, e.name));
    }
  } catch {
    /* 没有 profiles 目录就算了 */
  }
  return out;
}

/** 选当前 profile：DSH_PROFILE 命中优先，否则取 package.json 最新修改的那个。 */
function pickProfile() {
  const dirs = profileCandidates();
  if (!dirs.length) return null;
  const want = process.env.DSH_PROFILE;
  if (want) {
    for (const d of dirs) {
      const pkg = readJson(join(d, 'package.json'));
      if (pkg && pkg.name === `dsh-profile-${want}`) return { dir: d, pkg };
      if (d.endsWith(`profiles${'\\'}${want}`) || d.endsWith(`profiles/${want}`)) {
        if (pkg) return { dir: d, pkg };
      }
    }
  }
  let best = null;
  for (const d of dirs) {
    const pkg = readJson(join(d, 'package.json'));
    if (!pkg) continue;
    let mtime = 0;
    try {
      mtime = statSync(join(d, 'package.json')).mtimeMs;
    } catch {
      /* ignore */
    }
    if (!best || mtime > best.mtime) best = { dir: d, pkg, mtime };
  }
  return best ? { dir: best.dir, pkg: best.pkg } : null;
}

function isOfficial(id) {
  return id.startsWith('@deepseek-ai/');
}

/* ------------------------------------------------------------------ */
/* 市场登记表：中文描述的来源                                            */
/*                                                                     */
/* 作者在 npm 包里写的 description 常是英文（给 npm 看的），而市场登记表  */
/* 里几乎每个插件都有中文 description.zh（给人看的）。所以面板优先用市场 */
/* 的中文，取不到才退回包自己的描述。                                    */
/* ------------------------------------------------------------------ */

const REGISTRY_CACHE = join(dshHome(), 'dsh-my-plugins-registry.json');
const REGISTRY_TTL = 6 * 3600_000;
const NOTES_PATH = join(HERE_DIR, '..', 'notes.json');
let refreshing = false;

/** 人写的一句话中文（优先于任何自动来源）。 */
function loadNotes() {
  try {
    const j = JSON.parse(readFileSync(NOTES_PATH, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function loadZhMap() {
  try {
    const c = JSON.parse(readFileSync(REGISTRY_CACHE, 'utf8'));
    if (c && c.map && typeof c.at === 'number') {
      if (Date.now() - c.at > REGISTRY_TTL) refreshZhMap();
      return c.map;
    }
  } catch {
    /* 还没有缓存 */
  }
  refreshZhMap();
  return {};
}

async function refreshZhMap() {
  if (refreshing) return;
  const base = process.env.DSH_WEB_URL;
  if (!base) return;
  refreshing = true;
  try {
    const r = await fetch(`${base}/dsh-market/registry`, { headers: { accept: 'application/json' } });
    if (!r.ok) return;
    const j = await r.json();
    const list = j?.registry?.plugins;
    if (!Array.isArray(list)) return;
    const map = {};
    for (const p of list) {
      const zh = p?.description?.zh;
      if (p?.name && typeof zh === 'string' && zh.trim()) map[p.name] = zh.trim();
    }
    writeFileSync(REGISTRY_CACHE, JSON.stringify({ at: Date.now(), map }), 'utf8');
    cache.at = 0; // 下次请求重新扫描，这次就能拿到中文
  } catch {
    /* 拿不到登记表就退回包自己的描述，不影响使用 */
  } finally {
    refreshing = false;
  }
}

function clip(s, n = 160) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** 从一个包里取「人话」：作者写的 displayName / dsh.name 优先，其次 description。 */
function humanize(pkg, id) {
  const title =
    (pkg && typeof pkg.dsh?.name === 'string' && pkg.dsh.name.trim()) ||
    (pkg && typeof pkg.displayName === 'string' && pkg.displayName.trim()) ||
    '';
  let desc = (pkg && typeof pkg.description === 'string' && pkg.description.trim()) || '';
  // 双语描述取前半段（很多插件写成「中文 · English」）
  if (desc.length > 160) desc = desc.slice(0, 158) + '…';
  return { title: title || id, desc };
}

let cache = { at: 0, data: null };

export function scan(force) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < CACHE_MS) return cache.data;

  const picked = pickProfile();
  if (!picked) {
    const empty = { ok: false, error: '找不到 profile（没有 ~/.dsh/profiles/*/package.json）', profile: null, plugins: [], total: 0, thirdParty: 0 };
    cache = { at: now, data: empty };
    return empty;
  }

  const { dir, pkg } = picked;
  const zhMap = loadZhMap();
  const notes = loadNotes();
  const profileName = String(pkg.name || '').replace(/^dsh-profile-/, '') || 'unknown';
  const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {};
  const declared = Array.isArray(pkg.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
  // bundles 是「实际加载」的名单；万一没有，退回到 dependencies 里所有插件
  const ids = declared.length ? declared : Object.keys(deps);

  const seen = new Set();
  const plugins = [];
  for (const rawId of ids) {
    const id = String(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === NS) continue; // 自己不列自己

    const nm = join(dir, 'node_modules', id, 'package.json');
    const modPkg = existsSync(nm) ? readJson(nm) : null;
    const { title, desc } = humanize(modPkg, id);
    // 优先级：人写的一句话 > 市场登记表的中文 > 包自己的描述
    const marketZh = typeof zhMap[id] === 'string' ? clip(zhMap[id]) : '';
    const humanZh = typeof notes[id] === 'string' ? clip(notes[id], 120) : '';
    const finalDesc = humanZh || marketZh || desc;
    const descSource = humanZh ? 'human' : marketZh ? 'market' : desc ? 'package' : 'none';
    const declaredVersion = deps[id];
    plugins.push({
      id,
      title,
      version: (modPkg && modPkg.version) || (typeof declaredVersion === 'string' ? declaredVersion.replace(/^[~^]/, '') : ''),
      desc: finalDesc,
      descSource,
      official: isOfficial(id),
      hasClient: Boolean(modPkg && (modPkg.dsh?.client || modPkg.exports?.['./client'] || modPkg.exports?.client)),
      hasTools: Boolean(modPkg && (modPkg.main || modPkg.exports?.['.'])),
    });
  }

  plugins.sort((a, b) => {
    if (a.official !== b.official) return a.official ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  const thirdParty = plugins.filter((p) => !p.official).length;
  const data = {
    ok: true,
    profile: { name: profileName, dir },
    total: plugins.length,
    thirdParty,
    plugins,
  };
  cache = { at: now, data };
  return data;
}

export function apply(ctx) {
  try {
    if (typeof ctx?.inject === 'function') {
      ctx.inject(['webServer'], (host) => {
        host.effect(() =>
          host.webServer.register(
            {
              kind: 'exact',
              path: `/${NS}/report`,
              handler: (req, res) => {
                let force = false;
                try {
                  force = new URL(req.url || '/', 'http://local').searchParams.get('force') === '1';
                } catch {
                  force = false;
                }
                let body;
                try {
                  body = JSON.stringify(scan(force));
                } catch (err) {
                  body = JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), plugins: [], total: 0, thirdParty: 0 });
                }
                res.writeHead(200, {
                  'content-type': 'application/json; charset=utf-8',
                  'cache-control': 'no-store',
                });
                res.end(body);
              },
            },
            `${NS}: report`,
          ),
        );
      });
    }
  } catch {
    /* 没有 webServer：面板缺失，宿主照常运行 */
  }
}
