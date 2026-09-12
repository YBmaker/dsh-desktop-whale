// build-icons.cjs —— 由 DSH 官方鲸鱼标记（FishLogo）生成鲸鱼图标
// 来源证据链：
//   1) @deepseek-ai/dsh-client-ui-brand-official/lib/client.js -> FishLogo（JSDoc: "the official whale mark"）
//   2) 前端 bundle 中 FISH_LOGO_PATH 常量（viewBox 23.16 x 17.04）
//   3) 官方 dist/favicon.svg 与该常量形状 IoU = 0.9762（同一标记）
// 用法: node build-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/** 解析 sharp：优先本包依赖，其次在 DSH 各 profile 的 node_modules 里找（DSH 环境通常已带）。 */
function resolveSharp() {
  try { return require('sharp'); } catch { /* 继续找 */ }
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profilesDir = path.join(dshHome, 'profiles');
  const candidates = [path.join(profilesDir, 'node_modules', 'sharp')];
  try {
    for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(profilesDir, entry.name, 'node_modules', 'sharp'));
    }
  } catch { /* profiles 不存在就算了 */ }
  for (const c of candidates) {
    if (fs.existsSync(c)) { try { return require(c); } catch { /* 换下一个 */ } }
  }
  throw new Error('找不到 sharp。请先 `npm i sharp`，或把 sharp 放在 %DSH_HOME%/profiles/*/node_modules 下。');
}
const sharp = resolveSharp();

const ASSETS = path.join(__dirname, '..', 'assets');
const PNGDIR = path.join(ASSETS, 'png');
const PATHFILE = path.join(ASSETS, 'fishlogo-path.txt'); // 官方 FISH_LOGO_PATH
const BRAND = '#4D6BFE'; // DeepSeek 品牌蓝
const SIZES = [256, 128, 64, 48, 32, 24, 16];
const VB_W = 23.16, VB_H = 17.04; // 官方 FishLogo 视图框

/** 从本机 DSH 安装的前端 bundle 里提取官方 FISH_LOGO_PATH（bc="M…"）。 */
function extractFromLocalBundle() {
  const bases = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'pnpm', 'store', 'v11', 'links', '@deepseek-ai', 'dsh-web-frontend') : '',
    path.join(os.homedir(), '.local', 'share', 'pnpm', 'store', 'v11', 'links', '@deepseek-ai', 'dsh-web-frontend'),
  ];
  for (const base of bases) {
    if (!base || !fs.existsSync(base)) continue;
    for (const ver of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ver.isDirectory()) continue;
      const verDir = path.join(base, ver.name);
      for (const hash of fs.readdirSync(verDir, { withFileTypes: true })) {
        if (!hash.isDirectory()) continue;
        const assetsDir = path.join(verDir, hash.name, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets');
        if (!fs.existsSync(assetsDir)) continue;
        for (const f of fs.readdirSync(assetsDir)) {
          if (!/^index-.*\.js$/.test(f)) continue;
          const m = /\bbc="(M[^"]+)"/.exec(fs.readFileSync(path.join(assetsDir, f), 'utf8'));
          if (m) return m[1];
        }
      }
    }
  }
  return null;
}

/** 官方路径：优先用已有文件，否则从本机安装现提取（发布物里因此不需要带任何素材）。 */
function loadPath() {
  if (fs.existsSync(PATHFILE)) {
    const d = fs.readFileSync(PATHFILE, 'utf8').trim();
    if (/^M[\d.\s-]/.test(d) && d.length >= 500) return d;
  }
  const d = extractFromLocalBundle();
  if (!d) throw new Error('找不到官方鲸鱼路径：请确认本机已安装 @deepseek-ai/dsh-web-frontend，或先跑 provenance-check.cjs');
  fs.mkdirSync(ASSETS, { recursive: true });
  fs.writeFileSync(PATHFILE, d, 'utf8');
  console.log('[build-icons] 已从本机 DSH 安装提取官方鲸鱼路径');
  return d;
}

/** 品牌蓝圆角方底 + 白色鲸鱼；鲸鱼按官方宽高比放置，四周留白一致 */
function squareSvg(d, size) {
  const box = 64, pad = 10;
  const w = box - pad * 2;
  const h = +(w * VB_H / VB_W).toFixed(3);
  const y = +((box - h) / 2).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}">
  <rect x="0" y="0" width="${box}" height="${box}" rx="14" ry="14" fill="${BRAND}"/>
  <g transform="translate(${pad},${y}) scale(${(w / VB_W).toFixed(6)})"><path d="${d}" fill="#ffffff"/></g>
</svg>`;
}

/** 透明底、品牌蓝的鲸鱼标记（挂件用） */
function markSvg(d, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VB_W} ${VB_H}">
  <path d="${d}" fill="${BRAND}"/>
</svg>`;
}

const render = (svg, size) => sharp(Buffer.from(svg), { density: 384 })
  .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toBuffer();

async function renderRaw(svg, size) {
  const { data } = await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data; // RGBA，自上而下
}

/** 单条 ICO 的 BMP(DIB)：BITMAPINFOHEADER + 自下而上 BGRA + 全 0 AND 掩码 */
function dibEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4, dstRow = y * size * 4;
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4, t = dstRow + x * 4;
      xor[t] = rgba[s + 2]; xor[t + 1] = rgba[s + 1]; xor[t + 2] = rgba[s]; xor[t + 3] = rgba[s + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, xor, Buffer.alloc(maskRow * size)]);
}

/** 组装 .ico：<=64 用 BMP 条目，>64 用 PNG 条目（Windows 经典兼容做法） */
async function buildIco(svg, outFile, sizes) {
  const images = [];
  for (const size of sizes) {
    if (size <= 64) images.push({ size, buf: dibEntry(await renderRaw(svg, size), size), kind: 'bmp' });
    else images.push({ size, buf: await render(svg, size), kind: 'png' });
  }
  const dir = Buffer.alloc(6 + images.length * 16);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach((img, i) => {
    const e = 6 + i * 16, dim = img.size >= 256 ? 0 : img.size;
    dir.writeUInt8(dim, e); dir.writeUInt8(dim, e + 1); dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.buf.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += img.buf.length;
  });
  const ico = Buffer.concat([dir, ...images.map((i) => i.buf)]);
  fs.writeFileSync(outFile, ico);
  console.log(`[build-icons] ${path.basename(outFile)}: ${ico.length} 字节, 条目 ${images.map((i) => i.size + i.kind[0]).join(',')}`);
}

(async () => {
  fs.mkdirSync(PNGDIR, { recursive: true });
  const d = loadPath();
  console.log(`[build-icons] 官方路径长度 ${d.length} 字符, viewBox ${VB_W}x${VB_H}`);

  fs.writeFileSync(path.join(ASSETS, 'deepseek-whale-mark.svg'), markSvg(d, 50), 'utf8');
  const BASE = 1024;
  await buildIco(squareSvg(d, BASE), path.join(ASSETS, 'deepseek-whale.ico'), SIZES);
  await buildIco(markSvg(d, BASE), path.join(ASSETS, 'deepseek-whale-mark.ico'), [256, 128, 64, 48, 32, 24, 16]);
  for (const n of SIZES) fs.writeFileSync(path.join(PNGDIR, `whale-square-${n}.png`), await render(squareSvg(d, n), n));
  for (const n of [256, 128, 64, 32, 16]) fs.writeFileSync(path.join(PNGDIR, `whale-mark-${n}.png`), await render(markSvg(d, n), n));
  console.log('[build-icons] PNG 输出完成');
})().catch((e) => { console.error('[build-icons] 失败:', e && e.stack ? e.stack : e); process.exit(1); });
