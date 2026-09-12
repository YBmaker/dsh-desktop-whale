// build-plugin.cjs —— 生成 dsh-whale-widget 的可加载产物（lib/）
// 用法: node build-plugin.cjs
//   src/index.js      --(复制)--> lib/index.js
//   src/client.js.tpl --(注入官方鲸鱼路径)--> lib/client.js
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', 'plugin', 'dsh-whale-widget');
const SRC = path.join(ROOT, 'src');
const LIB = path.join(ROOT, 'lib');
const PATHFILE = path.join(__dirname, '..', 'assets', 'fishlogo-path.txt');

function main() {
  fs.mkdirSync(LIB, { recursive: true });

  const whalePath = fs.readFileSync(PATHFILE, 'utf8').trim();
  if (!/^M[\d.\s-]/.test(whalePath) || whalePath.length < 500) {
    throw new Error('fishlogo-path.txt 内容异常，先运行 build-icons.cjs / compare-marks.cjs 生成');
  }
  if (/["\\\n]/.test(whalePath)) throw new Error('官方路径含需要转义的字符，拒绝直接内联');

  const host = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  fs.writeFileSync(path.join(LIB, 'index.js'), host, 'utf8');

  const tpl = fs.readFileSync(path.join(SRC, 'client.js.tpl'), 'utf8');
  if (!tpl.includes('__WHALE_PATH__')) throw new Error('模板缺少 __WHALE_PATH__ 占位符');
  const client = tpl.split('__WHALE_PATH__').join(whalePath);
  if (client.includes('__WHALE_PATH__')) throw new Error('占位符替换不完整');
  fs.writeFileSync(path.join(LIB, 'client.js'), client, 'utf8');

  // 语法校验（只解析，不执行）
  const node = process.execPath;
  for (const f of ['index.js', 'client.js']) {
    execFileSync(node, ['--check', path.join(LIB, f)], { stdio: 'inherit' });
    console.log(`[build-plugin] 语法 OK: lib/${f}`);
  }
  console.log(`[build-plugin] 鲸鱼路径 ${whalePath.length} 字符已内联；产物目录 ${LIB}`);
}

try {
  main();
} catch (e) {
  console.error('[build-plugin] 失败:', e && e.message ? e.message : e);
  process.exit(1);
}
