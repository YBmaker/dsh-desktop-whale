// add-bom.cjs —— 给 tools\dsh-desktop 下的 .ps1 补 UTF-8 BOM
// 原因：Windows PowerShell 5.1 对无 BOM 的 .ps1 按 ANSI(GBK) 解析，中文字符串会导致语法错误。
// 幂等：已有 BOM 则跳过。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'logs') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ps1')) out.push(full);
  }
  return out;
}

let changed = 0;
for (const file of walk(ROOT)) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 3).equals(BOM)) {
    console.log(`[add-bom] 已有 BOM: ${path.relative(ROOT, file)}`);
    continue;
  }
  fs.writeFileSync(file, Buffer.concat([BOM, buf]));
  console.log(`[add-bom] 已补 BOM: ${path.relative(ROOT, file)}`);
  changed++;
}
console.log(`[add-bom] 完成，修改 ${changed} 个文件`);
