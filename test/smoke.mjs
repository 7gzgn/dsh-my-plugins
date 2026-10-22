/**
 * smoke: 在真机上跑一遍 scan()，断言它真的读到了当前 profile 的插件。
 * 断言不依赖具体插件名（别人的机器上装的不一样），只看结构。
 */
import { scan } from '../lib/index.js';

const d = scan(true);

const fail = (msg) => {
  console.error('FAIL:', msg);
  process.exit(1);
};

if (!d.ok) fail('report not ok: ' + (d.error || '?'));
if (!d.profile || !d.profile.name) fail('no profile resolved');
if (typeof d.total !== 'number' || d.total < 1) fail('total < 1');
if (!Array.isArray(d.plugins)) fail('plugins not array');
if (d.plugins.length !== d.total) fail('total mismatch');
if (typeof d.thirdParty !== 'number') fail('thirdParty missing');

for (const p of d.plugins) {
  if (!p.id) fail('plugin without id');
  if (typeof p.official !== 'boolean') fail('plugin without official flag: ' + p.id);
  if (p.id === 'dsh-my-plugins') fail('listed itself');
}

const noVer = d.plugins.filter((p) => !p.version).length;
const noDesc = d.plugins.filter((p) => !p.desc).length;

console.log(`profile=${d.profile.name} total=${d.total} thirdParty=${d.thirdParty}`);
console.log(`missing version: ${noVer}, missing description: ${noDesc}`);
console.log('--- sample ---');
for (const p of d.plugins.slice(0, 6)) {
  console.log(`  [${p.official ? 'builtin' : 'third '}] ${p.id}@${p.version || '?'} — ${p.title}`);
  if (p.desc) console.log(`      ${p.desc.slice(0, 70)}`);
}
console.log('OK');
