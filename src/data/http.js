// Every request WIRE makes goes through here, so each one says honestly what it is: "WIRE/<version>",
// never a browser's User-Agent. Set "homepage" in package.json and it's added as a contact URL.
// `net: true` uses Electron's network stack (Chromium's), which some government sites need
// (federalreserve.gov and bls.gov drop Node's own fetch); outside Electron it falls back to fetch.
const pkg = require("../../package.json");

const UA = `WIRE/${pkg.version} (macOS market news app${pkg.homepage ? "; +" + pkg.homepage : ""})`;

function fetcher(net) {
  if (net) {
    try { const e = require("electron"); if (e?.net?.fetch) return e.net.fetch.bind(e.net); } catch {}
  }
  return fetch;
}

/** GET (or POST with `body`) with a timeout. Throws on a non-2xx reply; the error carries `status`. */
async function request(url, { timeoutMs = 12000, headers = {}, net = false, method, body } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetcher(net)(url, { signal: ac.signal, method, body, redirect: "follow", headers: { "User-Agent": UA, Accept: "*/*", ...headers } });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; e.res = res; throw e; }
    return res;
  } finally { clearTimeout(t); }
}

const getText = async (url, opts) => (await request(url, opts)).text();
const getJSON = async (url, opts) => (await request(url, { ...opts, headers: { Accept: "application/json", ...opts?.headers } })).json();

module.exports = { UA, request, getText, getJSON };
