require('dotenv').config();
const ping = require('ping');
const { pool } = require('./db');
const { pub, CHANNELS } = require('./redis');

function ipRangeFromCidr(cidr) {
  // naive /24 support plus simple ranges; expand later for general CIDR
  if (!cidr) return [];
  const [base, mask] = cidr.split('/');
  if (mask !== '24') return [];
  const octets = base.split('.');
  const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
  const ips = [];
  for (let i = 1; i < 255; i++) ips.push(`${prefix}.${i}`);
  return ips;
}

async function upsertDevice(ip, alive, rtt) {
  if (!alive) return; // store only alive for MVP
  await pool.query(
    `INSERT INTO devices (ip, last_seen, rtt)
     VALUES ($1, now(), $2)
     ON CONFLICT (ip) DO UPDATE SET last_seen = EXCLUDED.last_seen, rtt = EXCLUDED.rtt`,
    [ip, rtt ?? null]
  );
}

async function sweepOnce() {
  const cidr = process.env.NETWORK_CIDR || '192.168.1.0/24';
  const ips = ipRangeFromCidr(cidr);
  const concurrency = 64;
  const chunks = [];
  for (let i = 0; i < ips.length; i += concurrency) chunks.push(ips.slice(i, i + concurrency));
  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map((ip) => ping.promise.probe(ip, { timeout: 1, extra: ['-n', '1'] }))
    );
    for (const r of results) {
      const rtt = r.alive ? Math.round(Number(r.time)) : null;
      if (r.alive) await upsertDevice(r.host, r.alive, rtt);
    }
  }
  const { rows } = await pool.query('SELECT id, ip, hostname, alias, rtt, last_seen FROM devices ORDER BY last_seen DESC NULLS LAST');
  await pub.publish(CHANNELS.DEVICES_UPDATED, JSON.stringify({ devices: rows }));
}

async function main() {
  console.log('Discovery worker started. CIDR:', process.env.NETWORK_CIDR);
  while (true) {
    try {
      await sweepOnce();
    } catch (e) {
      console.error('Sweep error', e);
    }
    await new Promise((r) => setTimeout(r, 15000)); // 15s
  }
}

main();
