// Dev helper: drive a test copy of Tickerkite started with --remote-debugging-port=<port>.
// Usage: node scripts/cdp.mjs <port> <screenshot.png | -> [js expression] [x,y,w,h clip]
const [port, shot, expr, clip] = process.argv.slice(2);
const pages = await (await fetch(`http://localhost:${port}/json`)).json();
const page = pages.find((p) => p.type === "page" && p.url.endsWith("index.html"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
await new Promise((r) => (ws.onopen = r));
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
if (expr && expr !== "-") { const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); console.log(JSON.stringify(r.result.result?.value ?? r.result)); }
if (shot && shot !== "-") { const p = { format: "png" }; if (clip) { const [x, y, width, height] = clip.split(",").map(Number); p.clip = { x, y, width, height, scale: 2 }; } const r = await call("Page.captureScreenshot", p); (await import("fs")).writeFileSync(shot, Buffer.from(r.result.data, "base64")); console.log("shot " + shot); }
ws.close();
