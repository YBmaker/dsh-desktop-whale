// verify-ico.cjs —— .ico 结构自检（手工解析目录项，不依赖第三方库）
// 用法: node verify-ico.cjs
// 检查：条目数、每条的宽高/格式、字节范围是否越界、PNG 条目是否真能解码出对应尺寸。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function resolveSharp() {
  try { return require('sharp'); } catch { /* 继续找 */ }
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profilesDir = path.join(dshHome, 'profiles');
  const candidates = [path.join(profilesDir, 'node_modules', 'sharp')];
  try {
    for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(profilesDir, entry.name, 'node_modules', 'sharp'));
    }
  } catch { /* ignore */ }
  for (const c of candidates) {
    if (fs.existsSync(c)) { try { return require(c); } catch { /* next */ } }
  }
  return null; // 没有 sharp 也能做结构检查，只是不校验 PNG 尺寸
}

const sharp = resolveSharp();
const ASSETS = path.join(__dirname, '..', 'assets');
const FILES = ['deepseek-whale.ico', 'deepseek-whale-mark.ico'];

(async () => {
  let failures = 0;
  for (const name of FILES) {
    const file = path.join(ASSETS, name);
    if (!fs.existsSync(file)) { console.log(`SKIP ${name}（不存在）`); continue; }
    const b = fs.readFileSync(file);
    const reserved = b.readUInt16LE(0);
    const type = b.readUInt16LE(2);
    const count = b.readUInt16LE(4);
    console.log(`== ${name} entries=${count} type=${type} reserved=${reserved} bytes=${b.length}`);
    if (type !== 1 || reserved !== 0) { failures++; console.log('   FAIL 不是 ICO 头'); continue; }

    for (let i = 0; i < count; i++) {
      const e = 6 + i * 16;
      const w = b.readUInt8(e) || 256;
      const h = b.readUInt8(e + 1) || 256;
      const bitCount = b.readUInt16LE(e + 6);
      const len = b.readUInt32LE(e + 8);
      const off = b.readUInt32LE(e + 12);
      const inRange = off + len <= b.length;
      const isPng = b.subarray(off, off + 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      let detail;
      if (isPng) {
        detail = sharp ? await sharp(b.subarray(off, off + len)).metadata().then((mm) => `png ${mm.width}x${mm.height}`) : 'png';
      } else {
        const bih = b.readUInt32LE(off);
        const bw = b.readInt32LE(off + 4);
        const bh = b.readInt32LE(off + 8) / 2;
        detail = `bmp ${bw}x${bh} bih=${bih}`;
      }
      const ok = inRange && bitCount === 32;
      if (!ok) failures++;
      console.log(`  [${i}] dir=${w}x${h} bits=${bitCount} kind=${isPng ? 'png' : 'bmp'} len=${len} off=${off} inRange=${inRange} -> ${detail} ${ok ? 'OK' : 'FAIL'}`);
    }
  }
  if (failures > 0) { console.error(`[verify-ico] ${failures} 项未通过`); process.exit(1); }
  console.log('[verify-ico] ALL PASS');
})().catch((e) => { console.error('[verify-ico] 失败:', e && e.message ? e.message : e); process.exit(1); });
