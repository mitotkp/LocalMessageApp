import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { httpError } from "./controllers/webController.js";

// Only this computer can open the interface: nobody else on the network can control your chat
const HOST = "127.0.0.1";
const PUBLIC_DIR = path.resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const MAX_BODY = 16 * 1024;

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

const sendJson = (res, status, data) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
};

const readJson = (req) => new Promise((resolve, reject) => {
    // Requiring JSON forces browsers to ask permission (CORS preflight) before another website
    // can post here, and this server never grants it
    if (!req.headers["content-type"]?.startsWith("application/json")) {
        return reject(httpError(415, "Content-Type must be application/json"));
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) {
            reject(httpError(413, "Request body too large"));
            req.destroy();
        }
    });
    req.on("end", () => {
        try {
            resolve(body ? JSON.parse(body) : {});
        } catch {
            reject(httpError(400, "Invalid JSON"));
        }
    });
    req.on("error", reject);
});

// Blocks requests coming from other websites (Origin) and DNS rebinding tricks (Host)
const isTrustedRequest = (req, port) => {
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowed.includes(req.headers.host)) return false;

    const origin = req.headers.origin;
    return !origin || allowed.some((host) => origin === `http://${host}`);
};

const serveStatic = async (pathname, res) => {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    } catch {
        return sendJson(res, 400, { error: "Bad path" });
    }

    // path.resolve + startsWith prevents "../" from reading files outside public/
    const file = path.resolve(PUBLIC_DIR, `.${decoded}`);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: "Forbidden" });

    try {
        const data = await readFile(file);
        res.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
        res.end(data);
    } catch {
        sendJson(res, 404, { error: "Not found" });
    }
};

// Server-Sent Events: a response that never ends, where the server writes one line per update
const openEventStream = (req, res, controller) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    const push = (update) => res.write(`data: ${JSON.stringify(update)}\n\n`);
    push({ type: "state", state: controller.state });
    controller.on("update", push);

    // Comment lines keep the connection alive through idle periods
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);

    req.on("close", () => {
        clearInterval(ping);
        controller.off("update", push);
    });
};

const routes = {
    "GET /api/rooms": (controller) => controller.searchRooms(),
    "POST /api/rooms": (controller, body) => controller.createRoom(body.nick, body.roomName),
    "POST /api/join": (controller, body) => controller.joinRoom(body.nick, body.roomId),
    "POST /api/messages": (controller, body) => controller.send(body.text),
    "POST /api/leave": (controller) => controller.leave(),
};

export const startWebServer = (controller, port) => new Promise((resolve, reject) => {
    controller.setMaxListeners(50); // one listener per open browser tab

    const server = http.createServer(async (req, res) => {
        if (!isTrustedRequest(req, port)) return sendJson(res, 403, { error: "Forbidden" });

        const { pathname } = new URL(req.url, `http://${req.headers.host}`);

        if (req.method === "GET" && pathname === "/api/events") {
            return openEventStream(req, res, controller);
        }

        const route = routes[`${req.method} ${pathname}`];
        if (!route) {
            if (req.method === "GET" && !pathname.startsWith("/api/")) return serveStatic(pathname, res);
            return sendJson(res, 404, { error: "Not found" });
        }

        try {
            const body = req.method === "POST" ? await readJson(req) : {};
            const result = await route(controller, body);
            sendJson(res, 200, result ?? { ok: true });
        } catch (err) {
            sendJson(res, err.status ?? 500, { error: err.message });
        }
    });

    server.once("error", reject);
    server.listen(port, HOST, () => resolve(server));
});
