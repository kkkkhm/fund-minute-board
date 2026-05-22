import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.HOST || (process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT || 3456);
const root = fileURLToPath(new URL(".", import.meta.url));
const upstream = "https://web1.345569.xyz";
const minuteMs = 60 * 1000;
const resetOffsetMs = (4 * 60 + 30) * minuteMs;
const dataDir = process.env.DATA_DIR || join(root, "server-data");
const historyFile = join(dataDir, "history.json");
const cache = new Map();
let assetManifest = null;
let serverOrigin = "";
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(response, status, headers, body) {
  response.writeHead(status, headers);
  response.end(body);
}

async function readJson(request, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function fetchUpstream(path, cacheMs = 0) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.time < cacheMs) {
    return cached;
  }

  let result;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      result = await fetch(`${upstream}${path}`, {
        headers: {
          accept: path.endsWith(".js") ? "text/javascript,*/*" : "application/json,*/*",
          "user-agent": "fund-minute-board/1.0"
        }
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
    }
  }
  if (!result) {
    throw lastError || new Error(`Could not fetch ${path}.`);
  }
  const body = Buffer.from(await result.arrayBuffer());
  const payload = {
    body,
    contentType: result.headers.get("content-type") || "application/octet-stream",
    status: result.status,
    time: Date.now()
  };

  if (result.ok && cacheMs) {
    cache.set(path, payload);
  }

  return payload;
}

async function currentAssets() {
  if (assetManifest && Date.now() - assetManifest.time < 5 * 60 * 1000) {
    return assetManifest;
  }

  const html = (await fetchUpstream("/", 30 * 1000)).body.toString("utf8");
  const script = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
  const stylesheet = html.match(/href="([^"]*\/assets\/[^"]+\.css)"/)?.[1];
  if (!script) {
    throw new Error("Could not discover the current upstream script asset.");
  }

  assetManifest = {
    script,
    stylesheet,
    time: Date.now()
  };
  return assetManifest;
}

function publicPath(urlPath) {
  const requested = urlPath === "/" || urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath;
  const target = normalize(join(root, "public", requested));
  const publicRoot = normalize(join(root, "public"));
  return target.startsWith(publicRoot) ? target : null;
}

function historyDay(timestamp = Date.now()) {
  return new Date(timestamp - resetOffsetMs).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function minuteBucket(timestamp = Date.now()) {
  return Math.floor(timestamp / minuteMs) * minuteMs;
}

function emptyHistory() {
  return {
    day: historyDay(),
    latest: [],
    lastCollectedAt: 0,
    points: {},
    sourceTime: ""
  };
}

class ServerCollector {
  constructor() {
    this.browser = null;
    this.collecting = null;
    this.history = emptyHistory();
    this.lastError = "";
    this.page = null;
    this.ready = false;
    this.timer = null;
  }

  async start() {
    await this.loadHistory();
    this.schedule(3000);
  }

  status() {
    return {
      collecting: Boolean(this.collecting),
      day: this.history.day,
      lastCollectedAt: this.history.lastCollectedAt,
      lastError: this.lastError,
      ready: this.ready,
      seriesCount: Object.keys(this.history.points).length
    };
  }

  publicHistory() {
    return {
      ...this.status(),
      latest: this.history.latest,
      points: this.history.points,
      sourceTime: this.history.sourceTime
    };
  }

  schedule(delay = minuteMs) {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.collect();
      this.schedule(Math.max(5000, minuteBucket() + minuteMs - Date.now() + 1200));
    }, delay);
  }

  async loadHistory() {
    try {
      const saved = JSON.parse(await readFile(historyFile, "utf8"));
      if (saved.day === historyDay() && saved.points) {
        this.history = { ...emptyHistory(), ...saved };
      }
    } catch {
      this.history = emptyHistory();
    }
  }

  async saveHistory() {
    await mkdir(dataDir, { recursive: true });
    await writeFile(historyFile, JSON.stringify(this.history, null, 2), "utf8");
  }

  async importPoints(payload) {
    if (payload?.day !== historyDay() || !payload.points || typeof payload.points !== "object") {
      throw new Error("Only current-day point history can be imported.");
    }
    if (this.history.day !== historyDay()) this.history = emptyHistory();

    let importedPoints = 0;
    let importedSeries = 0;
    for (const [id, incoming] of Object.entries(payload.points)) {
      if (!id || !Array.isArray(incoming)) continue;
      const merged = new Map((this.history.points[id] || []).map((point) => [point.time, point]));
      const before = merged.size;
      for (const point of incoming) {
        const time = Number(point?.time);
        const change = Number(point?.change);
        if (!Number.isFinite(time) || !Number.isFinite(change) || historyDay(time) !== this.history.day) continue;
        merged.set(minuteBucket(time), { change, time: minuteBucket(time) });
      }
      const points = [...merged.values()].sort((left, right) => left.time - right.time);
      if (!points.length) continue;
      this.history.points[id] = points;
      importedPoints += Math.max(0, merged.size - before);
      importedSeries += 1;
    }
    await this.saveHistory();
    return {
      importedPoints,
      importedSeries,
      seriesCount: Object.keys(this.history.points).length
    };
  }

  async ensurePage() {
    if (this.page && !this.page.isClosed()) return this.page;

    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    await this.page.goto(`${serverOrigin}/collector-source.html`, { waitUntil: "domcontentloaded" });
    return this.page;
  }

  async collect() {
    if (this.collecting) return this.collecting;
    this.collecting = this.readSource().finally(() => {
      this.collecting = null;
    });
    return this.collecting;
  }

  async readSource() {
    try {
      const page = await this.ensurePage();
      await page.waitForSelector(".fund-row", { timeout: 30000 });
      const payload = await page.evaluate(() => {
        const percent = (text) => {
          const value = Number.parseFloat(String(text).replace("%", ""));
          return Number.isFinite(value) ? value : 0;
        };
        const idText = (name) => name.normalize("NFKC").replace(/\s+/g, "-");
        const orderedText = (container) => {
          if (!container) return "";
          return [...container.querySelectorAll(".sc:not(.sc-d)")]
            .map((node, index) => ({
              index,
              order: Number.parseInt(node.style.order || "0", 10),
              text: node.textContent || ""
            }))
            .sort((left, right) => left.order - right.order || left.index - right.index)
            .map((part) => part.text)
            .join("")
            .replace(/\s+/g, "")
            .trim();
        };
        const funds = [...document.querySelectorAll(".fund-row")].map((row) => {
          const name = orderedText(row.querySelector(".fund-name"));
          const changeText = orderedText(row.querySelector(".fund-impact"));
          return {
            change: percent(changeText),
            changeText,
            id: idText(name),
            name,
            session: orderedText(row.querySelector(".session-badge")) || "--",
            type: "fund"
          };
        }).filter((item) => item.name && item.changeText);
        const markets = [...document.querySelectorAll(".summary-card")].map((card) => {
          const name = card.querySelector(".summary-name")?.textContent?.trim() || "";
          const changeText = card.querySelector(".summary-value")?.textContent?.trim() || "";
          return {
            change: percent(changeText),
            changeText,
            id: `market:${idText(name)}`,
            name,
            session: "指标",
            type: "market"
          };
        }).filter((item) => item.name && item.changeText);
        return {
          items: [...markets, ...funds],
          sourceTime: document.querySelector(".summary-time")?.textContent?.trim() || ""
        };
      });

      if (!payload.items.length) throw new Error("The upstream page rendered no collectible rows.");
      if (this.history.day !== historyDay()) this.history = emptyHistory();
      const timestamp = Date.now();
      const pointTime = minuteBucket(timestamp);
      for (const item of payload.items) {
        const points = this.history.points[item.id] || [];
        const next = { change: item.change, time: pointTime };
        if (points[points.length - 1]?.time === pointTime) {
          points[points.length - 1] = next;
        } else {
          points.push(next);
        }
        this.history.points[item.id] = points.filter((point) => historyDay(point.time) === this.history.day);
      }
      this.history.latest = payload.items;
      this.history.lastCollectedAt = timestamp;
      this.history.sourceTime = payload.sourceTime;
      this.lastError = "";
      this.ready = true;
      await this.saveHistory();
    } catch (error) {
      this.ready = Boolean(this.history.lastCollectedAt);
      this.lastError = error instanceof Error ? error.message : "Unknown collector error";
      if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
      if (this.browser) await this.browser.close().catch(() => {});
      this.page = null;
      this.browser = null;
    }
  }
}

const collector = new ServerCollector();

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || host}`);

  try {
    if (url.pathname === "/health") {
      send(response, 200, { "content-type": types[".json"] }, JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/server-api/history") {
      send(response, 200, {
        "cache-control": "no-store",
        "content-type": types[".json"]
      }, JSON.stringify(collector.publicHistory()));
      return;
    }

    if (url.pathname === "/server-api/import" && request.method === "POST") {
      const result = await collector.importPoints(await readJson(request));
      send(response, 200, {
        "cache-control": "no-store",
        "content-type": types[".json"]
      }, JSON.stringify({ ok: true, ...result }));
      return;
    }

    if (url.pathname === "/api/lkjhgfdsa") {
      const payload = await fetchUpstream(url.pathname);
      send(response, payload.status, {
        "cache-control": "no-store",
        "content-type": payload.contentType
      }, payload.body);
      return;
    }

    if (url.pathname === "/source/upstream.js" || url.pathname === "/source/upstream.css") {
      const assets = await currentAssets();
      const asset = url.pathname.endsWith(".js") ? assets.script : assets.stylesheet;
      if (!asset) {
        send(response, 404, { "content-type": "text/plain; charset=utf-8" }, "Missing asset");
        return;
      }
      const payload = await fetchUpstream(asset, 5 * 60 * 1000);
      send(response, payload.status, {
        "cache-control": "public, max-age=300",
        "content-type": payload.contentType
      }, payload.body);
      return;
    }

    const filePath = publicPath(url.pathname);
    if (!filePath) {
      send(response, 403, { "content-type": "text/plain; charset=utf-8" }, "Forbidden");
      return;
    }

    const body = await readFile(filePath);
    send(response, 200, {
      "cache-control": url.pathname === "/" ? "no-cache" : "public, max-age=60",
      "content-type": types[extname(filePath)] || "application/octet-stream"
    }, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    send(response, 502, { "content-type": types[".json"] }, JSON.stringify({
      error: "Proxy or file read failed",
      message
    }));
  }
});

server.listen(port, host, () => {
  const collectorHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  serverOrigin = `http://${collectorHost}:${port}`;
  console.log(`Fund board listening on http://${host}:${port}`);
  console.log(`Collector history directory: ${dataDir}`);
  collector.start().catch((error) => {
    collector.lastError = error instanceof Error ? error.message : "Collector did not start.";
  });
});
