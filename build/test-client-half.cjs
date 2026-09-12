// test-client-half.cjs —— 在 Node 里用假 window/__ModuleLoader__ 跑一遍客户端半边
// 验证：模块体不抛错；导出 apply/inject；apply 会 inject('shell.overlay') 并注册 { id: 'whale-widget' }
const fs = require('node:fs');
const path = require('node:path');

const BUNDLE = path.join(__dirname, '..', 'plugin', 'dsh-whale-widget', 'lib', 'client.js');
const source = fs.readFileSync(BUNDLE, 'utf8');

let captured = null;
global.window = {
  __ModuleLoader__: {
    load(definition) { captured = definition; },
  },
};

// 只提供工厂真正会 require 的模块（顶层只用 react）
const stubReact = {
  createElement: () => ({}),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
};

const requireStub = (name) => {
  if (name === 'react') return stubReact;
  throw new Error('unexpected require: ' + name);
};

try {
  // 直接求值 bundle；它在顶层调用 window.__ModuleLoader__.load
  new Function('require', 'window', source)(requireStub, global.window);
} catch (e) {
  console.error('[test-client] 模块体抛错:', e && e.message ? e.message : e);
  process.exit(1);
}

if (!captured) { console.error('[test-client] 未捕获到 __ModuleLoader__.load 调用'); process.exit(1); }
console.log('[test-client] bundle id =', captured.id);
if (captured.id !== 'dsh-whale-widget') { console.error('[test-client] id 与包名不一致'); process.exit(1); }

const mod = captured.factory(requireStub);
console.log('[test-client] exports =', Object.keys(mod).join(', '));
if (typeof mod.apply !== 'function') { console.error('[test-client] 缺少 apply'); process.exit(1); }
console.log('[test-client] inject =', JSON.stringify(mod.inject));
if (JSON.stringify(mod.inject) !== '["slots"]') { console.error('[test-client] inject 不是 ["slots"]'); process.exit(1); }

const injected = [];
const registered = [];
const ctxStub = {
  slots: {
    inject(key, cb) { injected.push(key); return cb(); },
    register(options, component) { registered.push({ options, component }); return () => {}; },
  },
};
mod.apply(ctxStub);

console.log('[test-client] injected slots =', JSON.stringify(injected));
console.log('[test-client] registered =', registered.map((r) => JSON.stringify(r.options) + ' component=' + typeof r.component).join(' | '));
if (injected[0] !== 'shell.overlay') { console.error('[test-client] 未注入 shell.overlay'); process.exit(1); }
if (!registered[0] || registered[0].options.id !== 'whale-widget') { console.error('[test-client] 注册 id 不是 whale-widget'); process.exit(1); }
if (typeof registered[0].component !== 'function') { console.error('[test-client] 注册的不是组件函数'); process.exit(1); }

console.log('[test-client] ALL PASS —— 客户端半边：模块体可执行、注入 shell.overlay、注册 id=whale-widget');
