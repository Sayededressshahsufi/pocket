/**
 * Zero-dependency static dev server.
 *
 *   node scripts/serve.mjs            -> http://localhost:5173
 *   PORT=8080 HOST=127.0.0.1 node scripts/serve.mjs
 *
 * Binds to all interfaces by default so you can open the app on a phone on
 * the same Wi-Fi. Set HOST=127.0.0.1 to keep it local-only.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC = /^\/(index\.html|manifest\.webmanifest|sw\.js|css\/|js\/|icons\/|$)/;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (!PUBLIC.test(path)) throw new Error("not public");
    if (path.endsWith("/")) path += "index.html";
    const file = resolve(ROOT, `.${path}`);
    if (!file.startsWith(ROOT + sep)) throw new Error("traversal");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Pocket running at:\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") {
    for (const nets of Object.values(networkInterfaces())) {
      for (const n of nets ?? []) {
        if (n.family === "IPv4" && !n.internal) console.log(`  Network: http://${n.address}:${PORT}`);
      }
    }
  }
  console.log("");
});
