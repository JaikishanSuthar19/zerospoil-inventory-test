# FreshMart Retail POS & Cold-Chain ERP v4.2

Standalone Supermarket Inventory Management System (POS & Cold-Chain Telemetry Bay) built for **Laptop 2** in the **ZeroSpoil** two-device live demonstration architecture.

## Overview
FreshMart Retail POS is designed as an enterprise-grade retail store inventory and cold-chain terminal. It communicates over local LAN with the ZeroSpoil AI middleware server on **Laptop 1** (`FastAPI` + `MongoDB` on port 8000).

- **Zero-Build Stack**: Pure HTML5, CSS3, and Vanilla JavaScript (ES6+). Zero npm/node build steps required.
- **Enterprise Aesthetics**: Clean slate/light retail ERP layout with emerald, amber, and crimson telemetry badges.
- **Real-Time LAN Synchronization**: Auto-polls `GET /api/state` every 2 seconds to reflect dynamic markdowns, cold-chain safety rail quarantines, and live stock decrements when shoppers claim deals.
- **Standalone Sandbox Testing Mode**: Complete offline testing simulation mode allowing the operator to test all features (shopper deal claims, +5°C chiller breaches, 7:00 PM auto-clearance audit, and batch inwarding) without Laptop 1.

---

## Project Structure
```text
.
├── index.html   # Main POS interface, LAN connection ribbon, summary cards & table
├── pos.css      # Enterprise ERP styling, cold-chain alert animations & responsive layout
├── pos.js       # Auto-polling engine, non-flickering DOM updates & API contracts
└── README.md    # Documentation & setup instructions
```

---

## Quick Start (Laptop 2)

Serve locally with Python's built-in HTTP server:
```bash
python3 -m http.server 3000
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## Live LAN Demo Walkthrough (Laptop 2 ↔ Laptop 1)

1. **Connect to Middleware**:
   - In the top ribbon, enter Laptop 1's local IP (e.g. `http://192.168.43.105:8000`) and click **Save & Connect**.
   - Status dot pulses **🟢 CONNECTED — Synced <1s ago**.

2. **Simulate Chiller Fault**:
   - Click **`+5°C Chiller Fault`** on any active dairy batch (`POST /api/pos/batches/{id}/temp-spike`).
   - The cold-chain safety rail detects the breach (`9.5°C`), turning the badge into a pulsing red alert and marking the status **`BIOGAS_QUARANTINE`**.

3. **Autonomous 7:00 PM Clearance Audit**:
   - Click **`Run 7:00 PM ZeroSpoil Clearance`** (`POST /api/agent/run-pos-audit`).
   - Near-expiry stock is dynamically marked down (e.g. ~~₹160~~ → **`₹96 (-40% AUTO-MARKDOWN)`**) or dispatched to NGOs (`DONATED`).

4. **Inward Near-Expiry Batches**:
   - Use 1-click presets (*Safe Bakery Surplus*, *Warm Dairy Trap*, *Farm-Fresh Greens*) in the Receiving Dock to inward new inventory batches into MongoDB (`POST /api/pos/batches`).

5. **Live Shopper Claim Sync**:
   - When consumers claim deals on Laptop 1's ZeroSpoil community feed, Laptop 2's in-store stock count animates and decrements live with real-time toast alerts.
