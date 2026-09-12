// test-host-half.cjs —— 在 Node 里用桩 ctx 端到端验证插件 Host 半边
// 验证点：apply 能注册 /whale/billing 路由；该路由能真实取到本机 /api/billing 并裁剪字段
// 用法: node test-host-half.cjs
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PLUGIN = path.join(__dirname, '..', 'plugin', 'dsh-whale-widget', 'lib', 'index.js');

function makeRes() {
  const out = { status: 0, headers: null, body: '' };
  return {
    out,
    writeHead(status, headers) { out.status = status; out.headers = headers; },
    end(chunk) { out.body += chunk === undefined ? '' : String(chunk); },
  };
}

(async () => {
  const mod = await import(pathToFileURL(PLUGIN).href);
  console.log('[test] module exports:', Object.keys(mod).join(', '));
  if (typeof mod.apply !== 'function') throw new Error('缺少 apply 导出');

  let captured = null;
  let effectRan = false;
  const stubCtx = {
    get(name) {
      if (name !== 'webServer') return undefined;
      return {
        register(route) { captured = route; return () => { captured = null; }; },
      };
    },
    effect(cb) { effectRan = true; const d = cb(); return typeof d === 'function' ? d : () => {}; },
    logger: { warn: (...a) => console.log('[test] warn:', ...a) },
  };

  mod.apply(stubCtx);
  console.log('[test] ctx.effect used:', effectRan);
  if (!captured) throw new Error('未捕获到路由注册');
  console.log('[test] route:', captured.kind, captured.path);
  if (captured.path !== '/whale/billing') throw new Error('路由路径不符');

  const res = makeRes();
  await captured.handler({ method: 'GET' }, res);
  console.log('[test] status:', res.out.status);
  const parsed = JSON.parse(res.out.body);
  console.log('[test] payload:', JSON.stringify(parsed, null, 2));

  if (parsed.ok !== true) throw new Error('上游未取到数据: ' + parsed.error);
  const b = parsed.billing;
  if (typeof b.totalBalance !== 'number') throw new Error('totalBalance 不是数字');
  if (typeof b.currency !== 'string') throw new Error('currency 缺失');
  console.log('[test] PASS —— Host 半边可用，余额', b.currency, b.totalBalance);

  const res405 = makeRes();
  await captured.handler({ method: 'POST' }, res405);
  const p405 = JSON.parse(res405.out.body);
  console.log('[test] POST ->', res405.out.status, p405.error);
  if (res405.out.status !== 405) throw new Error('非 GET 应返回 405');
  console.log('[test] ALL PASS');
})().catch((e) => { console.error('[test] FAIL:', e && e.message ? e.message : e); process.exit(1); });
