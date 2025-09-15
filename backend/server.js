require('dotenv').config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const os = require('os');
const ping = require('ping');
const hasDb = !!process.env.DATABASE_URL;
const hasRedis = !!process.env.REDIS_URL;
let pool, init, sub, pub, CHANNELS;
let storage;
if (hasDb) ({ init, pool } = require('./db'));
if (hasRedis) ({ sub, pub, CHANNELS } = require('./redis'));
if (!hasDb || !hasRedis) storage = require('./storage');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.get("/", (req, res) => {
  res.send("Backend is running");
});

// Scan status and manual trigger
let isScanning = false;
let lastScan = null;
app.get('/api/scan/status', (req, res) => {
  res.json({ isScanning, lastScan });
});
app.post('/api/admin/scan', async (req, res) => {
  if (isScanning) return res.status(202).json({ ok: true, isScanning: true });
  isScanning = true;
  try {
    await sweepOnceEmit();
    lastScan = new Date().toISOString();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'scan_failed' });
  } finally {
    isScanning = false;
  }
});

// REST: devices list
app.get('/api/devices', async (req, res) => {
  try {
    if (hasDb) {
      const { rows } = await pool.query('SELECT id, ip, hostname, alias, rtt, last_seen FROM devices ORDER BY last_seen DESC NULLS LAST');
      return res.json({ devices: rows });
    }
    return res.json({ devices: storage.listDevices() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_list_devices' });
  }
});

// REST: ping a device immediately
app.post('/api/devices/ping', express.json(), async (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ error: 'ip_required' });
  try {
    const result = await ping.promise.probe(ip, { timeout: 1, extra: ['-n', '1'] });
    const rtt = result.alive ? Math.round(Number(result.time)) : null;
    if (result.alive) {
      if (hasDb) {
        await pool.query(
          `INSERT INTO devices (ip, last_seen, rtt)
           VALUES ($1, now(), $2)
           ON CONFLICT (ip) DO UPDATE SET last_seen = EXCLUDED.last_seen, rtt = EXCLUDED.rtt`,
          [ip, rtt]
        );
      } else {
        storage.upsertDevice(ip, rtt);
      }
    }
    const payload = { ip, rtt, alive: result.alive };
    if (hasRedis) await pub.publish(CHANNELS.PING_RESULT, JSON.stringify(payload));
    io.emit('ping:result', payload);
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'ping_failed' });
  }
});

// WebSocket: handle chat + device updates
io.on("connection", (socket) => {
  console.log("New client connected");

  // Chat messages
  socket.on("chat:send", (msg) => {
    // Direct message support: if msg.to is provided, send only to that peer
    if (msg && msg.to && peersById.has(msg.to)) {
      const target = peersById.get(msg.to);
      const sender = sockets.get(socket.id);
      const payload = { ...msg, from: sender?.name || 'anon', fromId: sender?.id, toId: msg.to };
      io.to(target.socketId).emit('chat:message', payload);
      socket.emit('chat:message', payload); // echo to sender
      return;
    }
    // Global broadcast (legacy)
    if (hasRedis) pub.publish(CHANNELS.CHAT_MESSAGE, JSON.stringify(msg));
    io.emit("chat:message", msg);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
    // Presence cleanup
    const info = sockets.get(socket.id);
    if (info) {
      sockets.delete(socket.id);
      peersById.delete(info.id);
      io.emit('presence:leave', { id: info.id });
      io.emit('presence:list', getPeersSummary());
    }
  });
});

// Redis subscriptions -> broadcast to WebSocket clients
if (hasRedis) {
  sub.subscribe(CHANNELS.CHAT_MESSAGE, CHANNELS.DEVICES_UPDATED, CHANNELS.PING_RESULT, (err) => {
    if (err) console.error('Redis subscribe error', err);
  });
  sub.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);
      if (channel === CHANNELS.CHAT_MESSAGE) io.emit('chat:message', data);
      if (channel === CHANNELS.DEVICES_UPDATED) io.emit('devices:update', data);
      if (channel === CHANNELS.PING_RESULT) io.emit('ping:result', data);
    } catch (e) {
      console.error('WS publish error', e);
    }
  });
}

const PORT = process.env.PORT || 5000;
const start = async () => {
  if (hasDb) {
    try {
      await init();
    } catch (e) {
      console.error('DB init failed; falling back to in-memory', e);
    }
  }
  server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
};
start();

// ----------------------
// Presence & device discovery (in-memory)
// ----------------------

// Simple presence tracking
const sockets = new Map(); // socketId -> { id, name, ip, socketId }
const peersById = new Map(); // id -> same object

function ipv4From(remoteAddress) {
  if (!remoteAddress) return null;
  // Handle IPv6-mapped IPv4 ::ffff:x.x.x.x
  const v4 = remoteAddress.replace('::ffff:', '');
  // Strip brackets if any
  return v4.startsWith('::') ? null : v4;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function getPeersSummary() {
  return Array.from(peersById.values()).map(p => ({ id: p.id, name: p.name, ip: p.ip }));
}

io.on('connection', (socket) => {
  const remote = socket.handshake.address || socket.request?.connection?.remoteAddress;
  const clientIp = ipv4From(remote);
  const id = randomId();
  const info = { id, name: 'anon', ip: clientIp, socketId: socket.id };
  sockets.set(socket.id, info);
  peersById.set(id, info);

  socket.emit('presence:welcome', { id, ip: clientIp });
  io.emit('presence:list', getPeersSummary());

  socket.on('presence:hello', ({ name }) => {
    const curr = sockets.get(socket.id);
    if (!curr) return;
    if (name && typeof name === 'string') curr.name = name.slice(0, 50);
    io.emit('presence:join', { id: curr.id, name: curr.name, ip: curr.ip });
    io.emit('presence:list', getPeersSummary());
  });
});

// Discovery loop: sweep /24 for the primary LAN interface
function getPrimaryIPv4() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address; // e.g., 192.168.1.42
      }
    }
  }
  return null;
}

function buildCidrFromIp(ip) {
  if (!ip) return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function ipRangeFromCidr(cidr) {
  if (!cidr) return [];
  const [base, mask] = cidr.split('/');
  if (mask !== '24') return [];
  const [a, b, c] = base.split('.');
  const prefix = `${a}.${b}.${c}`;
  const ips = [];
  for (let i = 1; i < 255; i++) ips.push(`${prefix}.${i}`);
  return ips;
}

async function sweepOnceEmit() {
  if (!storage) storage = require('./storage');
  const localIp = getPrimaryIPv4();
  const cidr = process.env.NETWORK_CIDR || buildCidrFromIp(localIp);
  if (!cidr) return; // nothing to do
  const ips = ipRangeFromCidr(cidr);
  const concurrency = 64;
  for (let i = 0; i < ips.length; i += concurrency) {
    const chunk = ips.slice(i, i + concurrency);
    try {
      const results = await Promise.all(
        chunk.map((ip) => ping.promise.probe(ip, { timeout: 1, extra: ['-n', '1'] }))
      );
      for (const r of results) {
        if (r.alive) storage.upsertDevice(r.host, Math.round(Number(r.time)) || null);
      }
    } catch (e) {
      // continue next chunk
    }
  }
  io.emit('devices:update', { devices: storage.listDevices() });
}

setInterval(() => {
  sweepOnceEmit().catch(() => {});
}, 20000); // every 20s
