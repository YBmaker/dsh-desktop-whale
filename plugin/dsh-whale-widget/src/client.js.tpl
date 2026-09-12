// dsh-whale-widget —— 浏览器半边（client plugin bundle）。
//
// 由 dsh-client-modules 作为 /plugins/dsh-whale-widget/client.js 提供，并通过
// window.__ModuleLoader__.load 在页面里求值。这是一个"真实"浏览器包，因此普通
// 浏览器 API（fetch / setInterval）可用；它只读同源路由，绝不接触 API Key。
//
// 挂件落在 shell.overlay（框架级浮层，默认可穿透，本条目自行开启 pointer-events），
// 因此不会遮挡或替换任何既有 UI。
window.__ModuleLoader__.load({
	id: "dsh-whale-widget",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var React = require("react");

		// 官方 FishLogo 路径（@deepseek-ai/dsh-client-ui-primitives 的鲸鱼标记）。
		var WHALE_PATH = "__WHALE_PATH__";
		var WHALE_VB = "0 0 23.16 17.04";

		var ENDPOINT = "/whale/billing";
		var FALLBACK_ENDPOINT = "/api/billing";
		var REFRESH_MS = 60000;

		var CSS = [
			".dshwhale-root{position:fixed;right:18px;bottom:18px;z-index:60;pointer-events:auto;",
			"font-family:inherit;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-primary);}",
			".dshwhale-btn{width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.18);",
			"background:#4D6BFE;display:flex;align-items:center;justify-content:center;cursor:pointer;",
			"box-shadow:0 6px 20px rgba(0,0,0,.28);transition:transform .16s ease,box-shadow .16s ease;padding:0;}",
			".dshwhale-btn:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 10px 26px rgba(0,0,0,.34);}",
			".dshwhale-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}",
			".dshwhale-btn svg{width:26px;height:19px;display:block;}",
			".dshwhale-dot{position:absolute;top:2px;right:2px;width:11px;height:11px;border-radius:50%;",
			"background:var(--dsw-alias-state-error-primary);border:2px solid var(--dsw-alias-bg-base);display:none;}",
			".dshwhale-btn[data-state='error'] .dshwhale-dot{display:block;}",
			".dshwhale-panel{position:absolute;right:0;bottom:56px;width:272px;box-sizing:border-box;",
			"background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;",
			"padding:14px;box-shadow:0 16px 44px rgba(0,0,0,.30);}",
			".dshwhale-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}",
			".dshwhale-head svg{width:22px;height:16px;flex:none;}",
			".dshwhale-title{font-weight:600;flex:1;}",
			".dshwhale-x{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;",
			"font-size:16px;line-height:1;padding:2px 4px;border-radius:6px;}",
			".dshwhale-x:hover{background:var(--dsw-alias-interactive-bg-hover);}",
			".dshwhale-amount{font-size:26px;font-weight:650;letter-spacing:-.02em;margin-bottom:2px;}",
			".dshwhale-sub{color:var(--dsw-alias-label-secondary);font-size:12px;margin-bottom:10px;}",
			".dshwhale-row{display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:12px;}",
			".dshwhale-row span:first-child{color:var(--dsw-alias-label-secondary);}",
			".dshwhale-row span:last-child{font-variant-numeric:tabular-nums;}",
			".dshwhale-sep{height:1px;background:var(--dsw-alias-border-l1);margin:9px 0;}",
			".dshwhale-foot{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;",
			"color:var(--dsw-alias-label-tertiary);}",
			".dshwhale-foot button{margin-left:auto;border:1px solid var(--dsw-alias-border-l1);",
			"background:transparent;color:var(--dsw-alias-label-secondary);border-radius:7px;cursor:pointer;",
			"font-size:11px;padding:2px 8px;}",
			".dshwhale-foot button:hover{background:var(--dsw-alias-interactive-bg-hover);}",
			".dshwhale-err{color:var(--dsw-alias-state-error-primary);font-size:12px;word-break:break-word;}",
		].join("");

		/** 官方鲸鱼标记。 */
		function Whale(props) {
			return React.createElement(
				"svg",
				{ viewBox: WHALE_VB, xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", focusable: "false" },
				React.createElement("path", { d: WHALE_PATH, fill: props.fill || "#ffffff" }),
			);
		}

		function money(value, currency) {
			if (typeof value !== "number" || !isFinite(value)) return "—";
			var symbol = currency === "USD" ? "$" : "¥";
			return symbol + value.toFixed(2);
		}

		function count(value) {
			if (typeof value !== "number" || !isFinite(value)) return "—";
			return value.toLocaleString("en-US");
		}

		function clock(iso) {
			if (typeof iso !== "string") return "—";
			var d = new Date(iso);
			if (isNaN(d.getTime())) return "—";
			var p = function (n) { return (n < 10 ? "0" : "") + n; };
			return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
		}

		/** 先读本插件的 Host 路由，再回退到桌面工具插件的原始路由。 */
		async function readBilling() {
			try {
				var r = await fetch(ENDPOINT, { cache: "no-store" });
				if (r.ok) {
					var wrapped = null;
					try { wrapped = await r.json(); } catch (e) { wrapped = null; }
					if (wrapped && wrapped.ok === true && wrapped.billing) {
						return { ok: true, billing: wrapped.billing, at: wrapped.at, source: ENDPOINT };
					}
					if (wrapped && wrapped.ok === false) {
						return { ok: false, error: String(wrapped.error || "upstream-unavailable") };
					}
				} else {
					var body = await r.text();
					if (body && body.indexOf("<") !== 0) {
						return { ok: false, error: "host-route-http-" + r.status };
					}
				}
			} catch (e) {
				/* 落到回退通道 */
			}
			try {
				var r2 = await fetch(FALLBACK_ENDPOINT, { cache: "no-store" });
				if (!r2.ok) return { ok: false, error: "fallback-http-" + r2.status };
				var raw = await r2.json();
				return { ok: true, billing: raw, at: new Date().toISOString(), source: FALLBACK_ENDPOINT };
			} catch (e) {
				return { ok: false, error: "无法读取余额：" + String((e && e.message) || e) };
			}
		}

		function Widget() {
			var openState = React.useState(false);
			var open = openState[0];
			var setOpen = openState[1];
			var dataState = React.useState({ phase: "loading" });
			var data = dataState[0];
			var setData = dataState[1];

			var load = function () {
				setData(function (prev) { return prev.phase === "ok" ? prev : { phase: "loading" }; });
				readBilling().then(function (res) {
					if (!res.ok) { setData({ phase: "error", error: res.error }); return; }
					setData({ phase: "ok", billing: res.billing, at: res.at, source: res.source });
				});
			};

			React.useEffect(function () { load(); }, []);
			React.useEffect(function () {
				if (!open) return undefined;
				var tick = setInterval(load, REFRESH_MS);
				return function () { clearInterval(tick); };
			}, [open]);

			var node = [];

			if (open) {
				var body = [];
				body.push(
					React.createElement("div", { className: "dshwhale-head", key: "h" },
						React.createElement(Whale, { fill: "#4D6BFE" }),
						React.createElement("span", { className: "dshwhale-title" }, "DeepSeek 余额"),
						React.createElement("button", {
							className: "dshwhale-x", type: "button", title: "关闭",
							onClick: function () { setOpen(false); },
						}, "\u00d7"),
					),
				);

				if (data.phase === "ok") {
					var b = data.billing || {};
					var usage = b.usage || {};
					body.push(
						React.createElement("div", { className: "dshwhale-amount", key: "amt" }, money(b.totalBalance, b.currency)),
						React.createElement("div", { className: "dshwhale-sub", key: "sub" },
							(b.isAvailable ? "账户可用" : "账户不可用") + " · " + (b.currency || "CNY")),
						React.createElement("div", { className: "dshwhale-row", key: "g" },
							React.createElement("span", null, "赠金"), React.createElement("span", null, money(b.grantedBalance, b.currency))),
						React.createElement("div", { className: "dshwhale-row", key: "t" },
							React.createElement("span", null, "充值余额"), React.createElement("span", null, money(b.toppedUpBalance, b.currency))),
						React.createElement("div", { className: "dshwhale-row", key: "c" },
							React.createElement("span", null, "估算花费"), React.createElement("span", null, money(b.estimatedCost, b.currency))),
						React.createElement("div", { className: "dshwhale-sep", key: "s1" }),
						React.createElement("div", { className: "dshwhale-row", key: "i" },
							React.createElement("span", null, "输入 tokens"), React.createElement("span", null, count(usage.input))),
						React.createElement("div", { className: "dshwhale-row", key: "o" },
							React.createElement("span", null, "输出 tokens"), React.createElement("span", null, count(usage.output))),
						React.createElement("div", { className: "dshwhale-row", key: "cr" },
							React.createElement("span", null, "缓存读取"), React.createElement("span", null, count(usage.cacheRead))),
						React.createElement("div", { className: "dshwhale-row", key: "se" },
							React.createElement("span", null, "会话数"), React.createElement("span", null, count(usage.sessions))),
					);
				} else if (data.phase === "error") {
					body.push(
						React.createElement("div", { className: "dshwhale-amount", key: "amt" }, "暂不可用"),
						React.createElement("div", { className: "dshwhale-err", key: "err" }, String(data.error || "未知原因")),
					);
				} else {
					body.push(React.createElement("div", { className: "dshwhale-amount", key: "amt" }, "读取中…"));
				}

				body.push(
					React.createElement("div", { className: "dshwhale-foot", key: "f" },
						React.createElement("span", null, "更新于 " + (data.phase === "ok" ? clock(data.at) : "—")),
						React.createElement("button", {
							type: "button", title: "立即刷新", onClick: function () { load(); },
						}, "刷新"),
					),
				);

				node.push(React.createElement("div", { className: "dshwhale-panel", key: "panel" }, body));
			}

			node.push(
				React.createElement("button", {
					key: "btn",
					className: "dshwhale-btn",
					type: "button",
					"data-state": data.phase === "error" ? "error" : "ok",
					title: open ? "收起 DeepSeek 余额" : "查看 DeepSeek 余额",
					"aria-label": "DeepSeek 余额",
					"aria-expanded": open,
					onClick: function () { setOpen(function (v) { return !v; }); },
				},
					React.createElement(Whale, null),
					React.createElement("span", { className: "dshwhale-dot" }),
				),
			);

			return React.createElement(
				"div",
				{ className: "dshwhale-root" },
				React.createElement("style", null, CSS),
				node,
			);
		}

		// slots 是硬依赖：声明 inject 后，Cordis 会等 slots 服务就绪再激活本插件，
		// 因此不存在"apply 时 slots 还没注册"的竞态。
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", function () {
				return ctx.slots.register({ name: "shell.overlay", id: "whale-widget", order: 50 }, Widget);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	},
});
