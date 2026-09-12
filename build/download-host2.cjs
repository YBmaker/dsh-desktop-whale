// download-host2.cjs —— 先测通道吞吐，再流式下载宿主二进制（避免长时间静默挂起）
// 用法: node download-host2.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = 'YUEEEEY/dsh-desktop-host';
const ASSET = 'dsh-desktop-windows-x64.exe';
const OUT = path.join(__dirname, 'dsh-desktop.exe');
const UA = 'dsh-whale-setup';

const CHANNELS = [
  ['direct', (u) => u],
  ['gh-proxy', (u) => `https://gh-proxy.com/${u}`],
  ['ghfast', (u) => `https://ghfast.top/${u}`],
];

function log(...a) { console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a); }

async function latestRelease() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}`);
  return r.json();
}

/** 用 Range 拿 256KB 估算吞吐并确认是 PE 文件 */
async function probe(url) {
  const t0 = Date.now();
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Range: 'bytes=0-262143' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ms = Date.now() - t0;
  const isMZ = buf.length > 2 && buf[0] === 0x4d && buf[1] === 0x5a;
  if (!isMZ) throw new Error('返回内容不是 PE 文件');
  return { buf, ms, kbps: Math.round(buf.length / 1024 / (ms / 1000)) };
}

(async () => {
  const rel = await latestRelease();
  const asset = (rel.assets || []).find((a) => a.name === ASSET);
  if (!asset) throw new Error(`Release ${rel.tag_name} 缺少资产 ${ASSET}`);
  log(`Release ${rel.tag_name} ${ASSET} 声明 ${asset.size} 字节`);

  let chosen = null;
  const head = new Map();
  for (const [name, wrap] of CHANNELS) {
    const url = wrap(asset.browser_download_url);
    try {
      const p = await probe(url);
      log(`探测 ${name}: 256KB in ${p.ms}ms (~${p.kbps} KB/s)`);
      head.set(name, { url, first: p.buf, kbps: p.kbps });
      if (!chosen || p.kbps > head.get(chosen).kbps) chosen = name;
    } catch (e) {
      log(`探测 ${name} 失败: ${e && e.message ? e.message : e}`);
    }
  }
  if (!chosen) throw new Error('所有通道都不可用');
  log(`选用通道: ${chosen}`);

  const { url, first } = head.get(chosen);
  const t0 = Date.now();
  const r = await fetch(url, {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(280000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const chunks = [];
  let received = 0;
  let lastLog = 0;
  for await (const chunk of r.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (received - lastLog > 1048576) {
      lastLog = received;
      log(`已接收 ${(received / 1048576).toFixed(2)} MiB (${Math.round(received / 1024 / ((Date.now() - t0) / 1000))} KB/s)`);
    }
  }
  const buf = Buffer.concat(chunks);
  log(`下载完成 ${buf.length} 字节，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (buf.length !== asset.size) throw new Error(`大小不符: ${buf.length} != ${asset.size}`);
  if (!(buf[0] === 0x4d && buf[1] === 0x5a)) throw new Error('不是 PE 文件');

  fs.writeFileSync(OUT, buf);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(OUT + '.meta.json', JSON.stringify({
    tag: rel.tag_name, asset: ASSET, size: buf.length, sha256: sha,
    channel: chosen, source: url, at: new Date().toISOString(),
  }, null, 2));
  log(`写入 ${OUT}  sha256=${sha}`);
})().catch((e) => { console.error('[download] 失败:', e && e.message ? e.message : e); process.exit(1); });
