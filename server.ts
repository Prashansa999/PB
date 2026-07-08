import { createServer } from "http";
import next from "next";
import { attachWebSocketServer } from "./lib/server/wsHandler";
import { createRoom } from "./lib/server/roomStore";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";

// A single unhandled rejection or thrown error anywhere (e.g. a stray sharp
// failure that isn't inside one of wsHandler's try/catch blocks) would
// otherwise crash the whole Node process — and with it every open
// WebSocket for every room, which is exactly the kind of "connection is
// lost" symptom this is guarding against. Log and keep serving instead.
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaught exception:", err);
});

// The server is created before `next()` so it can be handed to Next as
// `httpServer` — that's what lets Next wire up its own dev-mode HMR
// WebSocket upgrade handling on this same server, alongside our own
// room/signaling WebSocketServer (mounted on a distinct `/ws` path below).
const server = createServer((req, res) => {
  // Next.js Route Handlers run inside Next's own bundled module graph
  // (Turbopack/webpack), which is a *different* module instance than the
  // one this plain tsx-executed file and wsHandler.ts share. That would
  // silently split the in-memory room registry in two. Room creation is
  // handled directly here, in the same module graph as the WebSocket
  // server, so both always see the same `roomStore` Map.
  if (req.method === "POST" && req.url === "/api/rooms") {
    const room = createRoom();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: room.code }));
    return;
  }
  handle(req, res);
});

const app = next({ dev, httpServer: server });
const handle = app.getRequestHandler();

attachWebSocketServer(server);

app.prepare().then(() => {
  server.listen(port, () => {
    console.log(`> S P Photobooth listening on http://localhost:${port} (${dev ? "dev" : "production"})`);
  });
});
