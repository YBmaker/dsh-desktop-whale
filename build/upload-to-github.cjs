// upload-to-github.cjs —— 用 GitHub REST API 把 skill 目录作为一个提交推上去
// （本机没有 git / gh，所以走 Git Data API：blobs → tree → commit → ref）
//
// 用法:
//   node upload-to-github.cjs --repo dsh-desktop-whale [--owner <user>] [--private]
//                             [--dir <skill 目录>] [--branch main] [--message <提交信息>]
//                             [--token-file <令牌文件>]
//
// 令牌解析顺序（从不打印令牌本身）:
//   1) --token-file 指定的文件
//   2) 环境变量 GITHUB_TOKEN / GH_TOKEN
//   3) <skill 目录>/.gh-token
//
// 行为：仓库不存在则创建（不带 auto_init），然后把目录内容作为一个提交推上 <branch>。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const API = 'https://api.github.com';
const UA = 'dsh-desktop-whale-uploader';

function parseArgs(argv) {
  const out = { branch: 'main', private: false, message: '', owner: '', repo: '', dir: '', tokenFile: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--private') { out.private = true; continue; }
    if (a === '--repo') { out.repo = argv[++i]; continue; }
    if (a === '--owner') { out.owner = argv[++i]; continue; }
    if (a === '--dir') { out.dir = argv[++i]; continue; }
    if (a === '--branch') { out.branch = argv[++i]; continue; }
    if (a === '--message') { out.message = argv[++i]; continue; }
    if (a === '--token-file') { out.tokenFile = argv[++i]; continue; }
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    throw new Error(`未知参数: ${a}`);
  }
  return out;
}

function readToken(opts) {
  const fromFile = (p) => {
    if (!p || !fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8').trim();
  };
  const candidates = [
    ['--token-file', fromFile(opts.tokenFile)],
    ['GITHUB_TOKEN', process.env.GITHUB_TOKEN || ''],
    ['GH_TOKEN', process.env.GH_TOKEN || ''],
    ['<dir>/.gh-token', fromFile(path.join(opts.dir, '.gh-token'))],
  ];
  for (const [src, val] of candidates) {
    if (val) return { token: val, source: src };
  }
  throw new Error('找不到 GitHub 令牌：请用 --token-file、GITHUB_TOKEN/GH_TOKEN 环境变量，或把令牌放到 <dir>/.gh-token');
}

async function api(token, method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text };
}

/** 收集要上传的文件：排除 .git / node_modules / 令牌文件 / 日志 */
function collectFiles(root) {
  const skipNames = new Set(['.git', 'node_modules', 'logs', '.gh-token', 'dsh-desktop.exe']);
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipNames.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (/\.(exe|log|tmp)$/i.test(e.name)) continue;
      if (e.name === 'ensure-status.json') continue;
      files.push(full);
    }
  };
  walk(root);
  files.sort();
  return files;
}

(async () => {
  const opts = parseArgs(process.argv);
  if (opts.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).join('\n')); return; }
  if (!opts.repo) throw new Error('必须给 --repo <仓库名>');
  if (!opts.dir) opts.dir = path.resolve(__dirname, '..', '..', '..', '.dsh', 'skills', 'dsh-desktop-whale');
  opts.dir = path.resolve(opts.dir);
  if (!fs.existsSync(opts.dir)) throw new Error(`目录不存在: ${opts.dir}`);

  const { token, source } = readToken(opts);
  console.log(`[upload] 令牌来源: ${source}（不打印内容）`);
  console.log(`[upload] 目录: ${opts.dir}`);

  const me = await api(token, 'GET', '/user');
  if (!me.ok) throw new Error(`令牌无效或权限不足（GET /user -> ${me.status}: ${me.text.slice(0, 200)}）`);
  const owner = opts.owner || me.json.login;
  console.log(`[upload] 身份: ${me.json.login}（owner=${owner}）`);

  // 1) 仓库不存在就创建
  let repoRes = await api(token, 'GET', `/repos/${owner}/${opts.repo}`);
  if (repoRes.status === 404) {
    console.log(`[upload] 仓库 ${owner}/${opts.repo} 不存在，创建中…`);
    const created = await api(token, 'POST', '/user/repos', {
      name: opts.repo,
      private: opts.private,
      has_issues: true,
      has_wiki: false,
      auto_init: false,
      description: 'DSH desktop launcher with the official DeepSeek whale icon + floating balance widget (packaged as a reusable DSH Skill)',
    });
    if (!created.ok) throw new Error(`创建仓库失败 ${created.status}: ${created.text.slice(0, 300)}`);
    repoRes = created;
  } else if (!repoRes.ok) {
    throw new Error(`读取仓库失败 ${repoRes.status}: ${repoRes.text.slice(0, 300)}`);
  }
  console.log(`[upload] 仓库就绪: ${repoRes.json.html_url}（private=${repoRes.json.private}）`);

  // 2) 逐文件建 blob
  const files = collectFiles(opts.dir);
  console.log(`[upload] 待上传 ${files.length} 个文件`);
  const tree = [];
  for (const full of files) {
    const rel = path.relative(opts.dir, full).split(path.sep).join('/');
    const buf = fs.readFileSync(full);
    const blob = await api(token, 'POST', `/repos/${owner}/${opts.repo}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    if (!blob.ok) throw new Error(`建 blob 失败 ${rel} ${blob.status}: ${blob.text.slice(0, 200)}`);
    tree.push({ path: rel, mode: '100644', type: 'blob', sha: blob.json.sha });
    console.log(`  + ${rel} (${buf.length} B)`);
  }

  // 3) 建 tree（无 base_tree：整棵树就是这些文件）
  const treeRes = await api(token, 'POST', `/repos/${owner}/${opts.repo}/git/trees`, { tree });
  if (!treeRes.ok) throw new Error(`建 tree 失败 ${treeRes.status}: ${treeRes.text.slice(0, 300)}`);

  // 4) 找父提交（空仓库则没有）
  const refRes = await api(token, 'GET', `/repos/${owner}/${opts.repo}/git/ref/heads/${opts.branch}`);
  const parents = [];
  if (refRes.ok && refRes.json && refRes.json.object) parents.push(refRes.json.object.sha);
  else console.log(`[upload] refs/heads/${opts.branch} 尚不存在（首推）`);

  const message = opts.message || `feat: dsh-desktop-whale skill (desktop launcher + whale balance widget)\n\n${files.length} files`;
  const commitRes = await api(token, 'POST', `/repos/${owner}/${opts.repo}/git/commits`, {
    message,
    tree: treeRes.json.sha,
    parents,
  });
  if (!commitRes.ok) throw new Error(`建 commit 失败 ${commitRes.status}: ${commitRes.text.slice(0, 300)}`);
  console.log(`[upload] commit: ${commitRes.json.sha.slice(0, 10)}`);

  // 5) 建/更新 ref
  if (parents.length === 0) {
    const refNew = await api(token, 'POST', `/repos/${owner}/${opts.repo}/git/refs`, {
      ref: `refs/heads/${opts.branch}`,
      sha: commitRes.json.sha,
    });
    if (!refNew.ok) throw new Error(`建 ref 失败 ${refNew.status}: ${refNew.text.slice(0, 300)}`);
  } else {
    const refUpd = await api(token, 'PATCH', `/repos/${owner}/${opts.repo}/git/refs/heads/${opts.branch}`, {
      sha: commitRes.json.sha,
      force: false,
    });
    if (!refUpd.ok) throw new Error(`更新 ref 失败 ${refUpd.status}: ${refUpd.text.slice(0, 300)}`);
  }

  console.log('');
  console.log(`完成 ✅  https://github.com/${owner}/${opts.repo}`);
  console.log(`提交:    https://github.com/${owner}/${opts.repo}/commit/${commitRes.json.sha}`);
})().catch((e) => { console.error('[upload] 失败:', e && e.message ? e.message : e); process.exit(1); });
