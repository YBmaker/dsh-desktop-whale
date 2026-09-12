// provenance-check.cjs —— 校验"官方鲸鱼标记"来源：favicon.svg 与前端 bundle 里的
// FISH_LOGO_PATH 是否同一形状（alpha 掩码 IoU）。
// 用法: node provenance-check.cjs [前端 bundle 的 index-*.js 路径]
// 不传参时自动在 pnpm store 里找 @deepseek-ai/dsh-web-frontend/dist/assets/index-*.js。
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

/** 在 pnpm store 里找 dsh-web-frontend 的前端 bundle（直接按 版本/哈希 两层定位，避免深度遍历）。 */
function findFrontendBundle() {
  const bases = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'pnpm', 'store', 'v11', 'links', '@deepseek-ai', 'dsh-web-frontend') : '',
    path.join(os.homedir(), '.local', 'share', 'pnpm', 'store', 'v11', 'links', '@deepseek-ai', 'dsh-web-frontend'),
  ];
  const hits = [];
  for (const base of bases) {
    if (!base || !fs.existsSync(base)) continue;
    for (const ver of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ver.isDirectory()) continue;
      const verDir = path.join(base, ver.name);
      for (const hash of fs.readdirSync(verDir, { withFileTypes: true })) {
        if (!hash.isDirectory()) continue;
        const assets = path.join(verDir, hash.name, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets');
        if (!fs.existsSync(assets)) continue;
        for (const f of fs.readdirSync(assets)) {
          if (/^index-.*\.js$/.test(f)) hits.push({ file: path.join(assets, f), ver: ver.name });
        }
      }
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.ver.localeCompare(b.ver));
  return hits[hits.length - 1].file;
}

async function alphaMask(d, vbW, vbH, W, H) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" width="${vbW}" height="${vbH}"><path d="${d}" fill="#000"/></svg>`;
  const buf = Buffer.from(svg);
  const { data, info } = await sharp(buf, { density: 300 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('路径渲染为空');
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  const { data: r } = await sharp(buf, { density: 300 })
    .extract({ left: minX, top: minY, width: tw, height: th })
    .resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { r, aspect: tw / th };
}

(async () => {
  const bundle = process.argv[2] || findFrontendBundle();
  if (!bundle || !fs.existsSync(bundle)) throw new Error('找不到前端 bundle，请把 index-*.js 路径作为参数传入');
  console.log('bundle =', bundle);

  const txt = fs.readFileSync(bundle, 'utf8');
  const m = /\bbc="(M[^"]+)"/.exec(txt);
  if (!m) throw new Error('bundle 里找不到 FISH_LOGO_PATH（bc="M..."）');
  const official = m[1];
  console.log(`FISH_LOGO_PATH 长度 ${official.length}`);

  // favicon 优先直接取本机安装里的那一份（发布物里因此不需要带任何素材）
  const favCandidates = [
    path.join(path.dirname(path.dirname(bundle)), 'favicon.svg'),
    path.join(__dirname, '..', 'assets', 'deepseek-whale-official.svg'),
  ];
  const favFile = favCandidates.find((p) => fs.existsSync(p));
  if (!favFile) throw new Error('找不到官方 favicon.svg：请确认本机已安装 @deepseek-ai/dsh-web-frontend');
  console.log('favicon =', favFile);
  const fav = fs.readFileSync(favFile, 'utf8').match(/\bd="([^"]+)"/)[1];
  console.log(`favicon 路径长度 ${fav.length}`);

  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'fishlogo-path.txt'), official, 'utf8');
  console.log('已把官方路径写入 assets/fishlogo-path.txt（build-icons.cjs 用它生成图标）');

  const W = 240, H = 120;
  const a = await alphaMask(official, 23.16, 17.04, W, H);
  const b = await alphaMask(fav, 50, 50, W, H);
  let inter = 0, uni = 0;
  for (let i = 0; i < W * H; i++) {
    const p = a.r[i * 4 + 3] > 127, q = b.r[i * 4 + 3] > 127;
    if (p || q) uni++;
    if (p && q) inter++;
  }
  const iou = inter / uni;
  console.log(`形状 IoU = ${iou.toFixed(4)}（官方 viewBox 宽高比 ${a.aspect.toFixed(3)} vs favicon ${b.aspect.toFixed(3)}）`);
  if (iou < 0.9) { console.error('[provenance] FAIL：两者不是同一标记'); process.exit(1); }
  console.log('[provenance] PASS —— favicon 与官方 FISH_LOGO_PATH 为同一鲸鱼标记');
})().catch((e) => { console.error('[provenance] 失败:', e && e.message ? e.message : e); process.exit(1); });
