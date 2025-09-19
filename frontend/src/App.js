import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const WS_URL = process.env.REACT_APP_WS_URL || 'http://localhost:5000';

function Devices({ socket, onStartChat, scanning, lastScan, onScanNow }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pingingIp, setPingingIp] = useState(null);
  const [ip, setIp] = useState('');

  useEffect(() => {
    // initial fetch
    fetch(`${WS_URL}/api/devices`)
      .then((r) => r.json())
      .then((d) => setDevices(d.devices || []))
      .catch(() => {})
      .finally(() => setLoading(false));

    const onUpdate = (payload) => {
      if (payload?.devices) setDevices(payload.devices);
    };
    socket.on('devices:update', onUpdate);
    return () => {
      socket.off('devices:update', onUpdate);
    };
  }, [socket]);

  useEffect(() => {
    const onPing = (p) => {
      if (!p?.ip) return;
      setDevices((prev) => {
        const next = [...prev];
        const idx = next.findIndex((d) => d.ip === p.ip);
        if (p.alive) {
          const rec = {
            id: idx >= 0 ? next[idx].id : Math.max(0, ...next.map((x) => x.id || 0)) + 1,
            ip: p.ip,
            hostname: idx >= 0 ? next[idx].hostname : null,
            alias: idx >= 0 ? next[idx].alias : null,
            rtt: p.rtt ?? null,
            last_seen: new Date().toISOString(),
          };
          if (idx >= 0) next[idx] = rec; else next.unshift(rec);
        }
        return next;
      });
      if (pingingIp === p.ip) setPingingIp(null);
    };
    socket.on('ping:result', onPing);
    return () => socket.off('ping:result', onPing);
  }, [socket, pingingIp]);

  const handlePing = async (ip) => {
    setPingingIp(ip);
    try {
      await fetch(`${WS_URL}/api/devices/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip }),
      });
    } catch {}
  };

  if (loading) return <div className="p-4">Loading devices…</div>;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Devices</h2>
      <div className="mb-4 flex gap-2 items-center flex-wrap">
        <input
          className="border rounded px-2 py-1 w-64"
          placeholder="Enter IP (e.g. 192.168.1.1)"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
        />
        <button
          className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
          onClick={() => ip && handlePing(ip)}
          disabled={!ip}
        >
          Ping IP
        </button>
        <button
          className="px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-50"
          onClick={onScanNow}
          disabled={scanning}
        >
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>
        <span className="text-xs text-gray-500">{lastScan ? `Last scan: ${new Date(lastScan).toLocaleTimeString()}` : ''}</span>
      </div>
      {devices.length === 0 ? (
        <div className="text-sm text-gray-600">No devices yet. Try pinging a known IP (e.g., your router/gateway) using the input above.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map((d) => (
          <div key={d.id || d.ip} className="bg-white shadow rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="font-mono">{d.ip}</div>
              <span className={`text-xs px-2 py-1 rounded ${d.rtt != null ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                {d.rtt != null ? `${d.rtt} ms` : 'unknown'}
              </span>
            </div>
            <div className="text-sm text-gray-500">Last seen: {d.last_seen ? new Date(d.last_seen).toLocaleString() : '—'}</div>
            <div className="flex gap-2">
              <button
                className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={() => handlePing(d.ip)}
                disabled={pingingIp === d.ip}
              >
                {pingingIp === d.ip ? 'Pinging…' : 'Ping'}
              </button>
              <button
                className="px-3 py-1 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => onStartChat?.(d.ip)}
              >
                Chat
              </button>
            </div>
          </div>
        ))}
        </div>
      )}
    </div>
  );
}

function Chat({ socket, activePeerId, peers, setActivePeerId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  useEffect(() => {
    const onMsg = (m) => setMessages((prev) => [...prev, m]);
    socket.on('chat:message', onMsg);
    return () => socket.off('chat:message', onMsg);
  }, [socket]);
  const send = () => {
    if (!text.trim()) return;
    const msg = { from: 'anon', text: text.trim(), to: activePeerId || null };
    socket.emit('chat:send', msg);
    setText('');
  };
  return (
    <div className="h-full flex gap-4">
      <aside className="w-64 space-y-2">
        <div className="font-semibold">Online peers</div>
        <div className="space-y-1 bg-white rounded border p-2 max-h-80 overflow-auto">
          {peers.map((p) => (
            <div
              key={p.id}
              className={`p-2 rounded cursor-pointer ${activePeerId===p.id?'bg-blue-100':'hover:bg-gray-100'}`}
              onClick={() => setActivePeerId(p.id)}
            >
              <div className="text-sm font-medium">{p.name || 'anon'}</div>
              <div className="text-xs text-gray-500">{p.ip}</div>
            </div>
          ))}
        </div>
      </aside>
      <div className="flex-1 flex flex-col">
        <div className="mb-2 text-sm text-gray-600">{activePeerId ? 'Direct message' : 'Global room'}</div>
        <div className="flex-1 overflow-auto space-y-2 p-2 bg-white rounded border">
        {messages.map((m, i) => (
          <div key={i} className="text-sm"><span className="font-semibold">{m.from}:</span> {m.text}</div>
        ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input className="flex-1 border rounded px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
          <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={send}>Send</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [view, setView] = useState('devices');
  const socket = useMemo(() => io(WS_URL, { transports: ['websocket'] }), []);
  const [peers, setPeers] = useState([]);
  const [activePeerId, setActivePeerId] = useState(null);
  const [nickname, setNickname] = useState(() => localStorage.getItem('lanc_nick') || 'anon');
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);

  useEffect(() => {
    const onList = (list) => setPeers(list);
    socket.on('presence:list', onList);
    socket.emit('presence:hello', { name: nickname || 'anon' });
    return () => {
      socket.off('presence:list', onList);
      socket.close();
    };
  }, [socket, nickname]);

  useEffect(() => {
    localStorage.setItem('lanc_nick', nickname || '');
  }, [nickname]);

  const scanNow = async () => {
    try {
      setScanning(true);
      await fetch(`${WS_URL}/api/admin/scan`, { method: 'POST' });
      const st = await fetch(`${WS_URL}/api/scan/status`).then(r=>r.json());
      setLastScan(st.lastScan || new Date().toISOString());
    } catch {}
    finally { setScanning(false); }
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow-md p-4">
        <h1 className="text-2xl font-bold text-primary">LanC</h1>
        <div className="mt-4">
          <div className="text-xs text-gray-500 mb-1">Nickname</div>
          <input className="w-full border rounded px-2 py-1" value={nickname} onChange={(e)=>setNickname(e.target.value)} placeholder="Enter nickname" />
        </div>
        <ul className="mt-6 space-y-2">
          <li className={`p-2 rounded hover:bg-gray-100 cursor-pointer ${view==='devices'?'bg-gray-100':''}`} onClick={() => setView('devices')}>Devices</li>
          <li className={`p-2 rounded hover:bg-gray-100 cursor-pointer ${view==='chat'?'bg-gray-100':''}`} onClick={() => setView('chat')}>Chat</li>
        </ul>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6">
        {view === 'devices' ? (
          <Devices socket={socket} scanning={scanning} lastScan={lastScan} onScanNow={scanNow} onStartChat={(ip) => {
            const peer = peers.find(p => p.ip === ip);
            if (peer) { setActivePeerId(peer.id); setView('chat'); }
          }} />
        ) : (
          <Chat socket={socket} activePeerId={activePeerId} peers={peers} setActivePeerId={setActivePeerId} />
        )}
      </main>
    </div>
  );
}

export default App;
