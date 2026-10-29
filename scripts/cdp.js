// Minimal Chrome DevTools Protocol client for Spotify (needs --remote-debugging-port=9222).
// Set CDP_PORT to use another port. Uses Node's global fetch/WebSocket (Node 22+). Usage:
//   node cdp.js eval "<expression>"   node cdp.js evalfile <expr.js>
//   node cdp.js shot <file.png>       node cdp.js perf <seconds>
//   node cdp.js console <seconds>     (attaches and prints console/exception events; does not reload)
// evalfile exists because PowerShell 5.1 strips embedded quotes from multi-line native arguments.
const fs = require("node:fs");
const PORT = Number(process.env.CDP_PORT) || 9222;

async function connect() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  if (!res.ok) throw new Error(`CDP target list failed: status=${res.status} body=${await res.text()}`);
  const pages = (await res.json()).filter((t) => t.type === "page");
  if (pages.length !== 1) {
    throw new Error(`Expected exactly 1 page target, got ${pages.length}: ${JSON.stringify(pages.map((p) => [p.title, p.url]))}`);
  }
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = (e) => fail(new Error(`CDP websocket error: ${e.message}`));
  });
  let nextId = 0;
  const waiting = new Map();
  const listeners = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id === undefined) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
      return;
    }
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.fail(new Error(`CDP ${w.method} failed: ${JSON.stringify(msg.error)}`));
    else w.ok(msg.result);
  };
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      const id = ++nextId;
      waiting.set(id, { ok, fail, method });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };
  return { send, on, close: () => ws.close() };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(`eval failed: expression=${expression} details=${JSON.stringify(r.exceptionDetails)}`);
  }
  return r.result.value;
}

async function metrics(cdp) {
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const cdp = await connect();
  try {
    if (cmd === "eval") {
      if (!arg) throw new Error("usage: cdp.js eval <expression>");
      console.log(JSON.stringify(await evaluate(cdp, arg), null, 2));
    } else if (cmd === "evalfile") {
      if (!arg) throw new Error("usage: cdp.js evalfile <expr.js>");
      console.log(JSON.stringify(await evaluate(cdp, fs.readFileSync(arg, "utf8")), null, 2));
    } else if (cmd === "console") {
      const seconds = Number(arg);
      if (!(seconds > 0)) throw new Error(`usage: cdp.js console <seconds>, got ${arg}`);
      const lines = [];
      const fmt = (v) => (v.value !== undefined ? JSON.stringify(v.value) : v.description || v.type);
      cdp.on("Runtime.consoleAPICalled", (p) => lines.push(`${p.type}: ${p.args.map(fmt).join(" ")}`));
      cdp.on("Runtime.exceptionThrown", (p) =>
        lines.push(`EXCEPTION: ${(p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text}`));
      cdp.on("Log.entryAdded", (p) => lines.push(`log/${p.entry.level}: ${p.entry.text}`));
      await cdp.send("Runtime.enable");
      await cdp.send("Log.enable");
      await new Promise((r) => setTimeout(r, seconds * 1000));
      console.log(lines.length ? lines.join("\n") : "(no console output)");
    } else if (cmd === "shot") {      if (!arg) throw new Error("usage: cdp.js shot <file.png>");
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(arg, Buffer.from(data, "base64"));
      console.log(`saved ${arg}`);
    } else if (cmd === "perf") {
      const seconds = Number(arg);
      if (!(seconds > 0)) throw new Error(`usage: cdp.js perf <seconds>, got ${arg}`);
      await cdp.send("Performance.enable");
      const a = await metrics(cdp);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      const b = await metrics(cdp);
      const per = (k) => ((b[k] - a[k]) / seconds).toFixed(4);
      console.log(JSON.stringify({
        seconds,
        taskCpuPerSec: per("TaskDuration"),
        scriptCpuPerSec: per("ScriptDuration"),
        layoutCpuPerSec: per("LayoutDuration"),
        styleCpuPerSec: per("RecalcStyleDuration"),
        jsHeapUsedMB: (b.JSHeapUsedSize / 1048576).toFixed(1),
        domNodes: b.Nodes,
      }, null, 2));
    } else {
      throw new Error(`unknown command "${cmd}". Use eval | shot | perf`);
    }
  } finally {
    cdp.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
