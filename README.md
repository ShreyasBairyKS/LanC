LAN Device Chat Pinger (LanC) — MVP

This repository contains a minimal backend and frontend to discover devices on a local network (manual ping + optional sweeps), show a live device list, and enable simple chat via WebSockets.

What’s included
- backend: Express + Socket.IO with optional Postgres/Redis. Falls back to in-memory stores if not configured.
- worker (optional): Discovery worker to sweep a subnet; requires Postgres/Redis and is intended for later.

Run locally (no containers)
Backend
1) Open a terminal in backend/ and install deps
   - npm install
2) Start the backend (uses in-memory storage by default)
   - npm start
   Backend will be on http://localhost:5000

Frontend
1) In another terminal, open frontend/
   - npm install
2) Create a .env file from .env.example (optional). By default it connects to http://localhost:5000
3) Start the UI
   - npm start

Optional advanced setup (no containers included)
If you later choose to add Postgres/Redis and the discovery worker, configure backend/.env (see backend/.env.example) and we can wire it up without Docker.

API
- GET /api/devices — list known devices
- POST /api/devices/ping { ip } — ping a device and broadcast result

WebSocket events
- devices:update — { devices: [...] }
- chat:message — chat payload
- ping:result — { ip, rtt, alive }

Notes
- The discovery worker (optional) currently supports /24 CIDR ranges for simplicity.
- For Windows, ICMP ping uses the system ping utility; ensure it’s available in PATH.
