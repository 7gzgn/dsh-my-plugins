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

/**
 * 从宿主自己的命令行里认出**正在跑的那个** profile。
 *
 * 为什么不靠 mtime：宿主每次启动都会把它扫到的 profile 的 package.json 重写一遍，
 * 于是"最新修改的"经常是一个根本没在跑的 profile（2026-11-02 的真实事故：
 * bili-duty 被启动流程重写后比 desktop 新，面板就报成「配置：bili-duty，2 个插件」，
 * 用户看到的像是插件全没了）。
 *
 * 宿主进程的 argv 里带着 profile 目录（`... --expose-internals <host.js> <app> <profiles/desktop>`），
 * 也可能只写 `--profile=desktop` / `--profile desktop` 这种名字形式，两种都认。
 */
function profileFromArgv() {
  const argv = process.argv || [];
  const root = join(dshHome(), 'profiles');
  // 1) 直接给了 profiles/<name> 路径
  for (const a of argv) {
    if (typeof a !== 'string') continue;
    const m = /[\\/]profiles[\\/]([^\\/]+?)[\\/]?$/.exec(a.trim());
    if (m && existsSync(join(root, m[1], 'package.json'))) return join(root, m[1]);
  }
  // 2) 只给了 --profile <name> / --profile=<name>
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    let want = null;
    if (/^--profile=/.test(a)) want = a.slice('--profile='.length);
    else if (a === '--profile' && i + 1 < argv.length) want = String(argv[i + 1]);
    if (!want) continue;
    if (existsSync(join(root, want, 'package.json'))) return join(root, want);
  }
  return null;
}

/**
 * 选当前 profile，优先级：
 *   1. DSH_PROFILE_DIR 指的那个（profileCandidates 已把它排在最前）
 *   2. DSH_PROFILE 指的那个
 *   3. 宿主命令行里认出来的那个（最可靠）
 *   4. 都没有才退回"package.json 最新修改的那个"（老办法，只在拿不到 argv 时当兜底）
 */
function pickProfile() {
  const dirs = profileCandidates();
  if (!dirs.length) return null;
  const first = dirs[0];
  if (process.env.DSH_PROFILE_DIR && first === process.env.DSH_PROFILE_DIR) {
    const pkg = readJson(join(first, 'package.json'));
    if (pkg) return { dir: first, pkg };
  }
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
  const fromArgv = profileFromArgv();
  if (fromArgv) {
    const pkg = readJson(join(fromArgv, 'package.json'));
    if (pkg) return { dir: fromArgv, pkg };
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
      if (!p?.name || typeof zh !== 'string' || !zh.trim()) continue;
      const v = zh.trim();
      map[p.name] = v;
      // 市场里的名字常带后缀（dsh-better-sidebar-N23），给个去掉后缀的别名指向同一条
      const alias = p.name.replace(/-[A-Za-z]+\d+$/, '');
      if (alias !== p.name && alias.length > 3 && map[alias] === undefined) map[alias] = v;
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

/**
 * 市场里的中文描述常见写法是「一句人话概括：细节、细节、细节」。
 * 把冒号后面那串细节砍掉，只留前面那半句——对"看不懂"的人来说那就是人话。
 * 太短（<6 字）或太长（>40 字）就不动，免得把正常句子切坏。
 */
function headPhrase(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(.{4,40}?)[：:]/);
  if (!m) return '';
  return m[1].trim();
}

/* ------------------------------------------------------------------ */
/* 用过没有：工具调用统计                                                */
/*                                                                     */
/* 插件加载了不等于在用。这里只记「工具被调过几次」这种粗粒度事实，        */
/* 用来回答一个很实际的问题：装了一堆，哪几个其实从来没被用过。            */
/* ------------------------------------------------------------------ */

const USAGE_PATH = join(dshHome(), 'dsh-my-plugins-usage.json');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '_verify', '_purge-src']);

function loadUsage() {
  try {
    const j = JSON.parse(readFileSync(USAGE_PATH, 'utf8'));
    if (j && typeof j.tools === 'object' && j.tools) return j;
  } catch {
    /* 还没有统计 */
  }
  return { tools: {} };
}

let saveTimer = null;
let pendingUsage = null;

function persistUsageNow() {
  if (!pendingUsage) return;
  try {
    writeFileSync(USAGE_PATH, JSON.stringify(pendingUsage), 'utf8');
  } catch {
    /* 写不进去就算了 */
  }
}

function scheduleUsageSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistUsageNow();
  }, 1500);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

function bumpUsage(toolName, ok) {
  const u = loadUsage();
  const row = u.tools[toolName] || (u.tools[toolName] = { calls: 0, ok: 0, fail: 0, lastAt: 0 });
  row.calls += 1;
  if (ok) row.ok += 1;
  else row.fail += 1;
  row.lastAt = Date.now();
  pendingUsage = u;
  scheduleUsageSave();
}

/** 插件目录里注册了哪些工具名（粗扫源码，够用就好）。 */
function collectToolNames(dir) {
  const names = new Set();
  const scan = (d, depth) => {
    if (depth > 3) return;
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) scan(p, depth + 1);
        continue;
      }
      if (!/\.(js|mjs|cjs)$/.test(e.name)) continue;
      let src;
      try {
        if (statSync(p).size > 2 * 1024 * 1024) continue;
        src = readFileSync(p, 'utf8');
      } catch {
        continue;
      }
      const re = /defineTool\s*\(\s*\{[\s\S]{0,500}?name:\s*['"`]([A-Za-z0-9_\-]+)['"`]/g;
      let m;
      while ((m = re.exec(src))) names.add(m[1]);
      const re2 = /\bname:\s*['"`]([A-Za-z0-9_\-]+)['"`][\s\S]{0,600}?(?:execute\s*\(|parameters\s*:)/g;
      while ((m = re2.exec(src))) names.add(m[1]);
    }
  };
  scan(dir, 0);
  return [...names];
}

/** 从一个包里取「人话」：作者写的 displayName / dsh.name 优先，其次 description。 */
function humanize(pkg, id) {
  const title =
    (pkg && typeof pkg.dsh?.name === 'string' && pkg.dsh.name.trim()) ||
    (pkg && typeof pkg.displayName === 'string' && pkg.displayName.trim()) ||
    '';
  let desc = (pkg && typeof pkg.description === 'string' && pkg.description.trim()) || '';
  // 作者的描述常常又长又技术，照样砍成一句：先取冒号前那半句，再硬截到 60 字
  if (desc) desc = clip(headPhrase(desc) || desc, 60);
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
  const usageTools = loadUsage().tools;
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

    const pluginDir = join(dir, 'node_modules', id);
    const nm = join(pluginDir, 'package.json');
    const modPkg = existsSync(nm) ? readJson(nm) : null;
    const toolNames = existsSync(pluginDir) ? collectToolNames(pluginDir) : [];
    let calls = 0;
    let ok = 0;
    let fail = 0;
    let lastAt = 0;
    for (const t of toolNames) {
      const r = usageTools[t];
      if (!r) continue;
      calls += r.calls || 0;
      ok += r.ok || 0;
      fail += r.fail || 0;
      if ((r.lastAt || 0) > lastAt) lastAt = r.lastAt;
    }
    const { title, desc } = humanize(modPkg, id);
    // 优先级：人写的一句话 > 市场登记表的中文（砍掉冒号后的细节） > 包自己的描述
    const marketRaw = typeof zhMap[id] === 'string' ? zhMap[id] : '';
    const marketZh = marketRaw ? clip(headPhrase(marketRaw) || marketRaw, 60) : '';
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
      toolCount: toolNames.length,
      calls,
      ok,
      fail,
      lastAt,
      used: calls > 0,
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
  const usedCount = plugins.filter((p) => p.used).length;
  // 「没用过」只该算**有工具却一次没调用**的；纯界面插件（toolCount 0）不参与，
  // 否则它们会被冤枉成吃灰，数字也会虚高。
  const idleCount = plugins.filter((p) => !p.used && p.toolCount > 0).length;
  const uiOnlyCount = plugins.filter((p) => p.toolCount === 0).length;
  const data = {
    ok: true,
    profile: { name: profileName, dir },
    total: plugins.length,
    thirdParty,
    usedCount,
    idleCount,
    uiOnlyCount,
    unusedCount: idleCount,
    plugins,
  };
  cache = { at: now, data };
  return data;
}

export function apply(ctx) {
  /* 统计「用过没有」：tool-call 的块里有工具名，tool/result 里只有 callId，
     所以先用 assistant/message 建 callId→name 映射，再在结果事件里记账。 */
  const callNames = new Map();
  try {
    if (typeof ctx?.on === 'function') {
      // { global: true } 是必须的：不传只能收到当前会话的事件，
      // 而这个统计要覆盖所有会话（DSH 自己的 dsh-tools 也是这么注册的）。
      ctx.on('session/event', (session, event) => {
        try {
          const t = event && event.type;
          if (t === 'assistant/message') {
            const blocks = event.data && event.data.message && event.data.message.content;
            if (Array.isArray(blocks)) {
              for (const b of blocks) {
                if (b && b.type === 'tool-call' && b.id && b.name) callNames.set(b.id, b.name);
              }
            }
          } else if (t === 'tool/result') {
            const m = event.data && event.data.message;
            const cid = m && m.source && m.source.callId;
            const nm = cid ? callNames.get(cid) : undefined;
            if (nm) {
              bumpUsage(nm, !m.isError);
              if (callNames.size > 800) callNames.clear();
            }
          }
        } catch {
          /* 统计失败不影响主流程 */
        }
      }, { global: true });
    }
  } catch {
    /* 没有事件通道时跳过统计 */
  }

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
