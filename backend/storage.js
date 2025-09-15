// Simple in-memory stores for development without Postgres/Redis

const devices = new Map(); // ip -> { id, ip, hostname, alias, rtt, last_seen }
let deviceAutoId = 1;

function upsertDevice(ip, rtt) {
  const now = new Date();
  if (devices.has(ip)) {
    const d = devices.get(ip);
    d.rtt = rtt ?? d.rtt ?? null;
    d.last_seen = now.toISOString();
    devices.set(ip, d);
    return d;
  }
  const rec = {
    id: deviceAutoId++,
    ip,
    hostname: null,
    alias: null,
    rtt: rtt ?? null,
    last_seen: now.toISOString(),
  };
  devices.set(ip, rec);
  return rec;
}

function listDevices() {
  return Array.from(devices.values()).sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || ''));
}

// Chat messages (keep only last 200)
const messages = [];
function addMessage(msg) {
  messages.push({ ...msg, created_at: new Date().toISOString() });
  if (messages.length > 200) messages.shift();
}
function listMessages(limit = 100) {
  return messages.slice(-limit);
}

module.exports = { upsertDevice, listDevices, addMessage, listMessages };
