#!/usr/bin/env node
import { createReadStream, promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootArg = process.argv[2];
const portArg = process.argv[3];
const host = process.argv[4] ?? "0.0.0.0";

if (!rootArg || !portArg) {
  console.error("Usage: serve-static.mjs <dist-root> <port> [host]");
  process.exit(2);
}

const root = path.resolve(process.cwd(), rootArg);
const port = Number(portArg);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Invalid port: ${portArg}`);
  process.exit(2);
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const filePath = await resolveFile(url.pathname);
    const stat = await fs.stat(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(status === 404 ? "Not found" : "Internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`Serving ${root} on http://${host}:${port}`);
});

async function resolveFile(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = path.resolve(root, `.${normalizedPath}`);
  if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) {
    throw new HttpError(404);
  }

  const stat = await statOrNull(candidate);
  if (stat?.isFile()) return candidate;
  if (stat?.isDirectory()) {
    const index = path.join(candidate, "index.html");
    if ((await statOrNull(index))?.isFile()) return index;
  }

  const spaIndex = path.join(root, "index.html");
  if ((await statOrNull(spaIndex))?.isFile()) return spaIndex;
  throw new HttpError(404);
}

async function statOrNull(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
