#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const DEFAULT_PORT = 8787;
const port = Number(process.env.LEAPS_BRIDGE_PORT || DEFAULT_PORT);
const host = process.env.LEAPS_BRIDGE_HOST || "127.0.0.1";
const commandTimeoutMs = Number(process.env.LEAPS_BRIDGE_COMMAND_TIMEOUT_MS || 15000);

const wss = new WebSocketServer({ host, port });
const viewers = new Map();
const pending = new Map();

wss.on("connection", (socket) => {
  socket.on("message", (data) => {
    handleMessage(socket, data).catch((error) => {
      send(socket, {
        type: "error",
        message: error.message,
      });
    });
  });

  socket.on("close", () => {
    if (socket.viewerId) {
      viewers.delete(socket.viewerId);
      process.stderr.write(`[bridge] viewer disconnected: ${socket.viewerId}\n`);
    }
    if (socket.mcpId) {
      process.stderr.write(`[bridge] mcp disconnected: ${socket.mcpId}\n`);
    }
  });
});

async function handleMessage(socket, data) {
  const message = JSON.parse(String(data));

  if (message.type === "register-viewer") {
    socket.viewerId = message.viewerId || randomUUID();
    socket.role = "viewer";
    viewers.set(socket.viewerId, {
      id: socket.viewerId,
      socket,
      connectedAt: new Date().toISOString(),
      info: message.info || {},
    });
    send(socket, {
      type: "registered",
      role: "viewer",
      viewerId: socket.viewerId,
    });
    process.stderr.write(`[bridge] viewer connected: ${socket.viewerId}\n`);
    return;
  }

  if (message.type === "register-mcp") {
    socket.mcpId = message.clientId || randomUUID();
    socket.role = "mcp";
    send(socket, {
      type: "registered",
      role: "mcp",
      clientId: socket.mcpId,
      viewers: listViewers(),
    });
    process.stderr.write(`[bridge] mcp connected: ${socket.mcpId}\n`);
    return;
  }

  if (message.type === "command") {
    const viewer = selectViewer(message.viewerId);
    if (!viewer) {
      send(socket, {
        type: "response",
        id: message.id,
        ok: false,
        error: "No viewer is connected to the bridge.",
      });
      return;
    }
    pending.set(message.id, {
      socket,
      timer: setTimeout(() => {
        pending.delete(message.id);
        send(socket, {
          type: "response",
          id: message.id,
          ok: false,
          error: `Viewer command timed out after ${commandTimeoutMs}ms.`,
        });
      }, commandTimeoutMs),
    });
    send(viewer.socket, {
      ...message,
      viewerId: viewer.id,
    });
    return;
  }

  if (message.type === "response") {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    send(request.socket, message);
    return;
  }

  if (message.type === "list-viewers") {
    send(socket, {
      type: "viewers",
      viewers: listViewers(),
    });
  }
}

function selectViewer(viewerId) {
  if (viewerId && viewers.has(viewerId)) return viewers.get(viewerId);
  return viewers.values().next().value || null;
}

function listViewers() {
  return Array.from(viewers.values(), (viewer) => ({
    id: viewer.id,
    connectedAt: viewer.connectedAt,
    info: viewer.info,
  }));
}

function send(socket, message) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

process.stderr.write(`[bridge] listening on ws://${host}:${port}\n`);
