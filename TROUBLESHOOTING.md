# Troubleshooting Guide — Local Development

This guide documents the most common setup issues contributors encounter and how to fix them. If your problem is not listed here, please open a [GitHub Issue](https://github.com/Core-Foundry/Notify-Chain/issues).

---

## Table of Contents

1. [Prerequisites Checklist](#1-prerequisites-checklist)
2. [Environment Variables](#2-environment-variables)
3. [Smart Contracts (Rust / Soroban)](#3-smart-contracts-rust--soroban)
4. [Listener Service (Node.js)](#4-listener-service-nodejs)
5. [Dashboard (React + Vite)](#5-dashboard-react--vite)
6. [General Issues](#6-general-issues)

---

## 1. Prerequisites Checklist

Before starting, verify every tool is installed and working:

```bash
rustc --version          # Rust compiler
cargo --version          # Rust package manager
stellar --version        # Stellar CLI
node --version           # Node.js (v18+ recommended)
npm --version            # npm package manager
```

### Install missing tools

**Rust**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

**WebAssembly target** (required for Soroban contracts)
```bash
rustup target add wasm32-unknown-unknown
```

**Stellar CLI**
```bash
cargo install --locked stellar-cli --features opt
```

**Node.js** — download the LTS version from https://nodejs.org

---

## 2. Environment Variables

### Listener Service (`listener/.env`)

Copy the example file and edit it:
```bash
cd listener
cp .env.example .env
```

Full reference with all available variables:

```bash
# ── Stellar Network ──────────────────────────────────────────────────────────
# RPC endpoint for the Stellar network to monitor
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
# Network passphrase (do not change for testnet)
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
# Comma-separated list of contract IDs to watch
CONTRACT_IDS=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# ── Listener API ─────────────────────────────────────────────────────────────
# Port the events HTTP API will listen on
PORT=8787
# How often (ms) the service polls for new on-chain events
POLLING_INTERVAL_MS=5000

# ── Discord Notifications (optional) ─────────────────────────────────────────
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_TOKEN

# ── Scheduler (optional) ─────────────────────────────────────────────────────
SCHEDULER_ENABLED=true
DATABASE_PATH=./data/notifications.db
SCHEDULER_POLL_INTERVAL_MS=10000
SCHEDULER_LOCK_TIMEOUT_MS=60000
SCHEDULER_BATCH_SIZE=10
SCHEDULER_TIMING_BUFFER_MS=60000
# Auto-generated if left empty
SCHEDULER_PROCESSOR_ID=
```

> **Tip for first-time contributors:** You only need `STELLAR_RPC_URL`, `CONTRACT_IDS`, and `PORT` to run the listener locally. Everything else is optional.

### Dashboard (`dashboard/.env`)

```bash
cd dashboard
```

Create a `.env` file:
```bash
# URL where your local listener is running
VITE_API_URL=http://localhost:8787
```

---

## 3. Smart Contracts (Rust / Soroban)

### ❌ `error: toolchain 'stable' does not support target 'wasm32-unknown-unknown'`

**Cause:** The WebAssembly target is not installed.

**Fix:**
```bash
rustup target add wasm32-unknown-unknown
```

---

### ❌ `error[E0463]: can't find crate for 'std'`

**Cause:** This happens when building without the correct target flag.

**Fix:** Always build with the wasm target:
```bash
cargo build --target wasm32-unknown-unknown --release
# or using Stellar CLI (handles the target automatically):
stellar contract build
```

---

### ❌ `stellar: command not found`

**Cause:** Stellar CLI is not installed or not in your PATH.

**Fix:**
```bash
cargo install --locked stellar-cli --features opt
# Then reload your shell:
source $HOME/.cargo/env
```

---

### ❌ `Error: Contract not found` when deploying

**Cause:** The `.wasm` file does not exist — the contract was not built first.

**Fix:**
```bash
# AutoShare contract
cd contract
stellar contract build

# TaskBounty contract
cd Documents/Task\ Bounty
stellar contract build
```

---

### ❌ Tests fail with `error: no such file or directory`

**Cause:** Running `cargo test` from the wrong directory.

**Fix:**
```bash
# AutoShare tests
cd contract/contracts/hello-world
cargo test

# TaskBounty tests
cd Documents/Task\ Bounty
cargo test
```

---

### ❌ `Error: account not found` when funding testnet identity

**Cause:** Friendbot rate limit or network issue.

**Fix:** Try again after a few seconds, or fund manually:
```bash
stellar keys generate my-identity --network testnet
stellar keys fund my-identity --network testnet
```

---

## 4. Listener Service (Node.js)

### ❌ `Cannot find module` / modules not found after cloning

**Fix:** Install dependencies first:
```bash
cd listener
npm install
```

---

### ❌ `Error: Database not initialized` or `SQLITE_ERROR: no such table`

**Cause:** The database migration has not been run.

**Fix:**
```bash
cd listener
npm run migrate
```

If the error persists:
```bash
# Make sure the data directory exists
mkdir -p data
NODE_ENV=development npm run migrate
```

---

### ❌ `Error: Cannot find module 'sqlite3'` (native module error)

**Cause:** Native bindings need to be rebuilt for your Node.js version.

**Fix:**
```bash
npm rebuild sqlite3
```

If that fails:
```bash
npm uninstall sqlite3
npm install sqlite3
```

---

### ❌ Listener starts but no events appear

**Checklist:**
1. Is `CONTRACT_IDS` set correctly in your `.env`?
   ```bash
   grep CONTRACT_IDS listener/.env
   ```
2. Is the contract deployed on the same network as `STELLAR_RPC_URL`?
3. Check live logs:
   ```bash
   cd listener
   npm run dev
   # Look for lines like: "Subscribed to contract C..."
   ```
4. Verify the API is responding:
   ```bash
   curl http://localhost:8787/health
   curl http://localhost:8787/api/events
   ```

---

### ❌ `EADDRINUSE: address already in use :::8787`

**Cause:** Port 8787 is already occupied by another process.

**Fix (Linux/macOS):**
```bash
lsof -i :8787
kill -9 <PID>
```

**Fix (Windows):**
```bash
netstat -ano | findstr :8787
taskkill /PID <PID> /F
```

Or change the port in your `.env`:
```bash
PORT=8788
```

---

### ❌ Discord notifications not being sent

**Checklist:**
1. Is `DISCORD_WEBHOOK_URL` set in `.env`?
2. Test the webhook manually:
   ```bash
   curl -H "Content-Type: application/json" \
     -d '{"content": "test"}' \
     YOUR_DISCORD_WEBHOOK_URL
   ```
3. Check logs for errors mentioning `DiscordNotificationService`.

---

## 5. Dashboard (React + Vite)

### ❌ Blank page or `Failed to fetch` error in the browser

**Cause:** The dashboard cannot reach the listener API.

**Checklist:**
1. Is the listener running? (`npm run dev` inside `listener/`)
2. Is `VITE_API_URL` set correctly in `dashboard/.env`?
   ```bash
   # Should match the port your listener is using
   VITE_API_URL=http://localhost:8787
   ```
3. Restart the Vite dev server after editing `.env`:
   ```bash
   cd dashboard
   npm run dev
   ```

---

### ❌ `Cannot find module` after cloning

**Fix:**
```bash
cd dashboard
npm install
```

---

### ❌ TypeScript errors when running `npm run build`

**Fix:** Run the linter first to catch issues:
```bash
cd dashboard
npm run lint
```

Address any reported errors, then build again:
```bash
npm run build
```

---

### ❌ Dashboard shows stale data / events not updating

**Cause:** The listener is not polling or the event store is empty.

**Fix:**
1. Confirm the listener is running and healthy:
   ```bash
   curl http://localhost:8787/health
   ```
2. Hard-refresh the browser (`Ctrl + Shift + R` / `Cmd + Shift + R`).
3. Check the browser console for network errors (F12 → Console).

---

## 6. General Issues

### ❌ `git clone` fails (SSL / certificate error)

```bash
# Temporary workaround — reset after cloning
git config --global http.sslVerify false
git clone https://github.com/Core-Foundry/Notify-Chain.git
git config --global http.sslVerify true
```

---

### ❌ Everything worked before, now nothing works after a `git pull`

Run the full refresh sequence:
```bash
# Contracts
cd contract && stellar contract build

# Listener
cd ../listener && npm install && npm run migrate

# Dashboard
cd ../dashboard && npm install
```

---

### Still stuck?

1. Search [open issues](https://github.com/Core-Foundry/Notify-Chain/issues) — your problem may already be reported.
2. Open a new issue with:
   - Your OS and version
   - Output of `rustc --version`, `node --version`, `stellar --version`
   - The full error message
   - Steps you already tried
