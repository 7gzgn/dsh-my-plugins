/**
 * registry smoke: 第一次调用会去拉市场登记表（异步），第二次应该能拿到中文描述。
 * 需要 DSH_WEB_URL 指向当前宿主（宿主侧插件天然有，命令行跑要手动给）。
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { scan } from '../lib/index.js';

const cacheFile = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-my-plugins-registry.json');
if (process.argv.includes('--fresh') && existsSync(cacheFile)) {
  rmSync(cacheFile);
  console.log('cleared cache');
}

const pick = (d, id) => d.plugins.find((p) => p.id === id);

let d = scan(true);
const before = pick(d, 'dsh-pet') || d.plugins[0];
console.log(`[1st] ${before.id} source=${before.descSource || '?'} desc=${String(before.desc).slice(0, 40)}`);

await new Promise((r) => setTimeout(r, 9000));

d = scan(true);
const after = pick(d, 'dsh-pet') || d.plugins[0];
console.log(`[2nd] ${after.id} source=${after.descSource || '?'} desc=${String(after.desc).slice(0, 60)}`);

const fromMarket = d.plugins.filter((p) => p.descSource === 'market').length;
const fromPkg = d.plugins.filter((p) => p.descSource === 'package').length;
const none = d.plugins.filter((p) => p.descSource === 'none').length;
console.log(`sources: market=${fromMarket} package=${fromPkg} none=${none} total=${d.total}`);
console.log('cache file:', existsSync(cacheFile) ? cacheFile : '(missing)');
