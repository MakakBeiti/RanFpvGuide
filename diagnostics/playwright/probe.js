const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "../..");
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".br": "application/octet-stream",
    ".css": "text/css",
    ".dat": "application/octet-stream",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".map": "application/json",
    ".png": "image/png",
    ".wasm": "application/wasm",
  }[ext] || "application/octet-stream";
}

function staticFileForUrl(url) {
  const requestUrl = new URL(url, "http://127.0.0.1");
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/RanFpvGuide") {
    pathname = "/RanFpvGuide/";
  }
  if (pathname.startsWith("/RanFpvGuide/")) {
    pathname = pathname.slice("/RanFpvGuide".length);
  }
  if (pathname === "/") {
    pathname = "/index.html";
  }
  const candidate = path.normalize(path.join(repoRoot, pathname));
  if (!candidate.startsWith(repoRoot)) {
    return null;
  }
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const filePath = staticFileForUrl(req.url);
    if (!filePath) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": contentType(filePath) });
    if (path.extname(filePath).toLowerCase() === ".js") {
      res.end(fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n"));
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        close: () => new Promise((done) => server.close(done)),
        url: `http://127.0.0.1:${port}/RanFpvGuide/`,
      });
    });
  });
}

async function probe(url) {
  const events = [];
  const browser = await chromium.launch({
    executablePath: edgePath,
    headless: true,
  });
  const page = await browser.newPage();

  page.on("console", (message) => events.push({ type: "console", level: message.type(), text: message.text() }));
  page.on("pageerror", (error) => events.push({ type: "pageerror", text: error.message }));
  page.on("requestfailed", (request) => {
    events.push({
      type: "requestfailed",
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText,
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      events.push({ type: "http", status: response.status(), url: response.url() });
    }
  });

  const started = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(12000);

  const state = await page.evaluate(() => ({
    title: document.title,
    bodyText: document.body.innerText,
    appHtml: document.querySelector("#app")?.innerHTML?.slice(0, 500) || "",
    loadingVisible: !!document.querySelector("#app .loading-progress"),
    errorUiDisplay: getComputedStyle(document.querySelector("#blazor-error-ui")).display,
    baseHref: document.querySelector("base")?.href,
  }));

  await browser.close();
  return {
    url,
    elapsedMs: Date.now() - started,
    state,
    events,
  };
}

(async () => {
  let server;
  const args = process.argv.slice(2);
  const targets = [];

  if (args.includes("--static")) {
    server = await startStaticServer();
    targets.push(server.url);
  }

  for (const arg of args) {
    if (!arg.startsWith("--")) {
      targets.push(arg);
    }
  }

  if (targets.length === 0) {
    targets.push("https://makakbeiti.github.io/RanFpvGuide/");
  }

  try {
    for (const target of targets) {
      const result = await probe(target);
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    if (server) {
      await server.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
