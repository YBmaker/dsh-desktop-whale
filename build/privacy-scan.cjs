// privacy-scan.cjs —— 发布前隐私自检：扫描目录里的文本文件，找出不该外发的本机/个人痕迹
//
// 用法:
//   node privacy-scan.cjs [--dir <目录>] [--deny <正则> ...] [--all]
//
// 说明:
//   * 内置规则是"通用型"的（用户目录、密钥形状、邮箱、会话 id、金额、盘符绝对路径…），
//     所以这个脚本本身不含任何机器专属信息，可以安全发布。
//   * 机器专属标识（用户名、本机目录名等）用 --deny 临时传入，不要写进本文件。
//   * 二进制文件（.ico/.png/.exe）默认跳过，只提示数量；用 --all 一并列出文件名。
// 退出码：发现命中 -> 1；干净 -> 0。
const fs = require('node:fs');
const path = require('node:path');

const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.json', '.yml', '.yaml', '.js', '.cjs', '.mjs', '.ts',
  '.ps1', '.cmd', '.bat', '.sh', '.svg', '.html', '.css', '.tpl', '.gitignore', '.xml',
]);

/** 通用规则：不要在发布物里出现的形状 */
const RULES = [
  { id: 'win-user-path', re: /[A-Za-z]:\\Users\\[^\\\s"')]+/g, hint: 'Windows 用户目录绝对路径' },
  { id: 'win-user-path-fwd', re: /[A-Za-z]:\/Users\/[^/\s"')]+/g, hint: 'Windows 用户目录绝对路径（正斜杠）' },
  { id: 'unix-home', re: /\/(?:home|Users)\/[A-Za-z0-9._-]{2,}(?:\/[^\s"')]*)?/g, hint: 'Unix 家目录绝对路径' },
  // 盘符路径：要求盘符前不是字母/数字，避免把 PowerShell 正则转义（如 'insert:\s*$'）误判成路径
  { id: 'drive-path', re: /(?<![A-Za-z0-9])[A-Za-z]:\\(?![\\\s])[^\s"',)]{3,}/g, hint: '盘符绝对路径（确认是否为示例）' },
  { id: 'openai-key', re: /sk-[A-Za-z0-9_-]{16,}/g, hint: '疑似 API Key（sk-…）' },
  { id: 'github-pat', re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g, hint: '疑似 GitHub 令牌' },
  { id: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{16,}/g, hint: '疑似 Bearer 令牌' },
  { id: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, hint: '邮箱地址' },
  { id: 'session-id', re: /session-[0-9a-f]{8}-[0-9a-f-]{8,}/g, hint: 'DSH 会话 id' },
  { id: 'money', re: /[¥$€]\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g, hint: '金额（确认是否为示意值）' },
  { id: 'private-ip', re: /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, hint: '内网 IP' },
  { id: 'anon-user-id', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, hint: 'UUID（确认是否为匿名 id）' },
];

function parseArgs(argv) {
  const out = { dir: path.join(__dirname, '..'), deny: [], all: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') { out.dir = path.resolve(argv[++i]); continue; }
    if (a === '--deny') { out.deny.push(new RegExp(argv[++i], 'g')); continue; }
    if (a === '--all') { out.all = true; continue; }
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    throw new Error(`未知参数: ${a}`);
  }
  return out;
}

function walk(dir, files = [], binaries = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'logs') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, files, binaries); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (TEXT_EXT.has(ext) || e.name === '.gitignore' || e.name === 'LICENSE') files.push(full);
    else binaries.push(full);
  }
  return { files, binaries };
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log('用法: node privacy-scan.cjs [--dir <目录>] [--deny <正则> …] [--all]');
    console.log('说明: 机器专属标识用 --deny 传入，不要写进本脚本。');
    return 0;
  }

  const { files, binaries } = walk(opts.dir);
  const rules = [
    ...RULES,
    ...opts.deny.map((re, i) => ({ id: `deny#${i + 1}`, re, hint: '调用方指定的机器专属标识' })),
  ];

  console.log(`扫描目录: ${opts.dir}`);
  console.log(`文本文件 ${files.length} 个；非文本 ${binaries.length} 个（默认不读内容）`);
  console.log(`规则 ${RULES.length} 条（通用）+ ${opts.deny.length} 条（--deny 机器专属）`);
  if (opts.all && binaries.length) {
    console.log('非文本文件：');
    for (const b of binaries) console.log(`  - ${path.relative(opts.dir, b)}`);
  }
  console.log('');

  let hits = 0;
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    const rel = path.relative(opts.dir, file);
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        rule.re.lastIndex = 0;
        const m = rule.re.exec(lines[i]);
        if (!m) continue;
        hits++;
        const shown = m[0].length > 80 ? `${m[0].slice(0, 80)}…` : m[0];
        console.log(`HIT  ${rel}:${i + 1}  [${rule.id}] ${rule.hint}`);
        console.log(`     ${shown}`);
      }
    }
  }

  console.log('');
  if (hits === 0) { console.log('干净：未发现需要处理的内容 ✅'); return 0; }
  console.log(`共 ${hits} 处命中，需逐条确认是否可外发 ❌`);
  return 1;
}

process.exit(main());
