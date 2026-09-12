// verify-pixels.cjs —— 图标像素构成自检（不依赖视觉模型）
// 用法: node verify-pixels.cjs
// 检查：方底图标应为"品牌蓝底 + 居中的白色鲸鱼"；透明底标记应为"透明背景 + 品牌蓝鲸鱼"。
// 判定：前景像素占比在合理区间，且前景包围盒居中（centerX/centerY 接近 50%）。
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
  throw new Error('找不到 sharp。');
}
const sharp = resolveSharp();

const DIR = path.join(__dirname, '..', 'assets', 'png');
const BRAND = { r: 0x4d, g: 0x6b, b: 0xfe };
const NAMES = ['whale-square-256.png', 'whale-square-32.png', 'whale-mark-256.png'];

(async () => {
  let failures = 0;
  for (const f of NAMES) {
    const file = path.join(DIR, f);
    if (!fs.existsSync(file)) { console.log(`SKIP ${f}（不存在）`); continue; }
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const isMark = f.includes('mark');

    let white = 0, blue = 0, clear = 0, other = 0;
    // 前景 = mark 图取蓝色；方底图取白色
    let minX = w, minY = h, maxX = -1, maxY = -1, fg = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 32) { clear++; continue; }
        const isWhite = r > 235 && g > 235 && b > 235;
        const isBlue = Math.abs(r - BRAND.r) < 40 && Math.abs(g - BRAND.g) < 40 && Math.abs(b - BRAND.b) < 40;
        if (isWhite) white++; else if (isBlue) blue++; else other++;
        const isFg = isMark ? isBlue : isWhite;
        if (isFg) {
          fg++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const total = w * h;
    const pct = (n) => (100 * n / total).toFixed(1) + '%';
    const cx = ((minX + maxX) / 2 / w) * 100;
    const cy = ((minY + maxY) / 2 / h) * 100;
    console.log(`${f} ${w}x${h} | white=${pct(white)} blue=${pct(blue)} clear=${pct(clear)} other=${pct(other)}`);
    console.log(`   fg(${isMark ? 'blue' : 'white'})=${pct(fg)} bbox=[${minX},${minY} -> ${maxX},${maxY}] center=${cx.toFixed(0)}%/${cy.toFixed(0)}% span=${(100 * (maxX - minX) / w).toFixed(0)}%x${(100 * (maxY - minY) / h).toFixed(0)}%`);

    const centred = Math.abs(cx - 50) <= 6 && Math.abs(cy - 50) <= 6;
    // 方底图有留白（span < 95%）；透明底标记的 viewBox 就是鲸鱼紧包围盒，理应铺满宽度
    const wSpan = (maxX - minX) / w;
    const spanOk = isMark ? (wSpan > 0.9) : (wSpan > 0.4 && wSpan < 0.95);
    const fgOk = isMark ? (fg / total > 0.1 && fg / total < 0.6) : (fg / total > 0.05 && fg / total < 0.5);
    if (!centred || !spanOk || !fgOk) {
      failures++;
      console.log(`   FAIL centred=${centred} spanOk=${spanOk} fgOk=${fgOk}（看图确认是否变形/裁切）`);
    } else {
      console.log('   OK');
    }
  }
  if (failures > 0) { console.error(`[verify-pixels] ${failures} 项未通过`); process.exit(1); }
  console.log('[verify-pixels] ALL PASS');
})().catch((e) => { console.error('[verify-pixels] 失败:', e && e.message ? e.message : e); process.exit(1); });
