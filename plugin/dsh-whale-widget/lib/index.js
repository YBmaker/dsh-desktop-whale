// dsh-whale-widget —— Host 半边。
//
// 只做一件事：注册一个只读路由 GET /whale/billing，把本机已有的计费数据
// （由 dsh-desktop-tools 在 /api/billing 提供：DeepSeek 账户余额 + 全部会话
// token 用量 + 估算花费）转发给挂件。这样：
//   * GUI 内挂件与桌面挂件读同一个来源，不各自重复实现计费逻辑；
//   * API Key 始终留在 Host 进程里，永不进入浏览器或桌面小程序；
//   * 若该来源不存在，路由返回 ok:false 与原因，挂件显示"暂不可用"而不是假数据。
//
// 这是一个"真实"插件（不是动态 Cordis 插件），因此在 Host 进程中拥有完整 Node
// 能力：global fetch / process.env 都可用。
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE_PATH = '/whale/billing';
const UPSTREAM_PATH = '/api/billing';
const TIMEOUT_MS = 12000;

/** 上游基址：优先用 dsh 自己注入的 DSH_WEB_URL，退回本机默认端口。 */
function upstreamBase() {
  const fromEnv = process.env && process.env.DSH_WEB_URL;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv.replace(/\/+$/, '');
  const port = (process.env && process.env.DSH_WEB_PORT) || '3080';
  return `http://127.0.0.1:${port}`;
}

/** 只挑挂件真正要显示的叶子字段，绝不把上游整个对象透传。 */
function pickBilling(raw) {
  const balance = raw && typeof raw.balance === 'object' && raw.balance !== null ? raw.balance : {};
  const usage = raw && typeof raw.usage === 'object' && raw.usage !== null ? raw.usage : {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v) => (typeof v === 'string' ? v : null);
  return {
    isAvailable: balance.isAvailable === true,
    currency: str(balance.currency) || 'CNY',
    totalBalance: num(balance.totalBalance),
    grantedBalance: num(balance.grantedBalance),
    toppedUpBalance: num(balance.toppedUpBalance),
    usage: {
      input: num(usage.input),
      output: num(usage.output),
      cacheRead: num(usage.cacheRead),
      cacheWrite: num(usage.cacheWrite),
      sessions: num(usage.sessions),
    },
    estimatedCost: num(raw ? raw.estimatedCost : null),
    prices: raw && typeof raw.prices === 'object' && raw.prices !== null
      ? {
          input: num(raw.prices.input),
          cacheRead: num(raw.prices.cacheRead),
          cacheWrite: num(raw.prices.cacheWrite),
          output: num(raw.prices.output),
        }
      : null,
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export const name = 'dsh-whale-widget';

/** webServer 是硬依赖：没有它本插件没有可贡献的东西。 */
export const inject = ['webServer'];

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  if (webServer === undefined) {
    ctx.logger?.warn?.('[whale-widget] webServer 不可用，跳过路由注册');
    return;
  }
  const base = upstreamBase();

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
          return;
        }
        const url = `${base}${UPSTREAM_PATH}`;
        try {
          const r = await fetch(url, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!r.ok) {
            sendJson(res, 200, { ok: false, error: `upstream-http-${r.status}`, source: url });
            return;
          }
          const text = await r.text();
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            sendJson(res, 200, { ok: false, error: 'upstream-not-json', source: url });
            return;
          }
          sendJson(res, 200, { ok: true, source: url, at: new Date().toISOString(), billing: pickBilling(parsed) });
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          sendJson(res, 200, { ok: false, error: `upstream-failed: ${message}`, source: url });
        }
      },
    }),
  );

  console.log(`[whale-widget] host half ready: GET ${ROUTE_PATH} -> ${base}${UPSTREAM_PATH}`);
}

// 保留 __dirname 语义（供后续扩展使用），并显式声明以免被打包器误删。
export const pluginDir = dirname(fileURLToPath(import.meta.url));
