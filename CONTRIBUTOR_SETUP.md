# Contributor Environment Setup Guide

This guide walks you through setting up a local development environment for NotifyChain. By the end, you will have the listener service, the dashboard, and the smart contracts building and running on your machine.

---

## Table of Contents

1. [Required Dependencies](#1-required-dependencies)
2. [Clone the Repository](#2-clone-the-repository)
3. [Listener Service Setup](#3-listener-service-setup)
4. [Dashboard Setup](#4-dashboard-setup)
5. [Smart Contracts Setup](#5-smart-contracts-setup)
6. [Environment Variables Reference](#6-environment-variables-reference)
7. [Running Tests](#7-running-tests)
8. [VS Code Setup (Recommended)](#8-vs-code-setup-recommended)
9. [Troubleshooting & FAQ](#9-troubleshooting--faq)

---

## 1. Required Dependencies

### Essential Toolchain

| Dependency     | Minimum Version | Install Method                          | Used By            |
|----------------|-----------------|-----------------------------------------|--------------------|
| Rust           | stable          | [rustup.rs](https://rustup.rs)          | Smart contracts    |
| `wasm32-unknown-unknown` | —       | `rustup target add wasm32-unknown-unknown` | Soroban contracts |
| Stellar CLI    | latest          | `cargo install stellar-cli`             | Contract build/deploy |
| Node.js        | **18** (dashboard), **20** (listener) | [nodejs.org](https://nodejs.org) or `nvm` | Listener, Dashboard |
| npm            | comes with Node  | —                                       | Package management |
| Git            | —               | Your package manager or [git-scm.com](https://git-scm.com) | Version control |

### Platform Notes

- **macOS**: Install Xcode Command Line Tools (`xcode-select --install`) before Rust.
- **Linux**: Install `build-essential` (`sudo apt install build-essential`) before Rust.
- **Windows**: Use [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022) with "C++ build tools" workload for native `sqlite3` bindings.

### Node.js Version Management

The project uses **two different Node.js versions** across its components:

| Workspace   | Node Version | CI Reference |
|-------------|-------------|--------------|
| `listener/` | **20**       | `.github/workflows/ci.yml` — `node-version: 20` |
| `dashboard/` | **18**      | `.github/workflows/ci.yml` — `node-version: 18` |

**Recommendation**: Use [nvm](https://github.com/nvm-sh/nvm) (Node Version Manager) to switch between versions:

```bash
# Install nvm (macOS/Linux)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Restart your terminal, then install both versions
nvm install 18
nvm install 20

# Use Node 20 for the listener (the more demanding component)
nvm use 20
```

For most local development, **Node 20 is sufficient** for both components. If you encounter CI-related issues, test against the specific version used in CI.

### Quick Install Commands

```bash
# ── Rust + WebAssembly + Stellar CLI ──
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt

# Verify
rustc --version && cargo --version && stellar --version
```

---

## 2. Clone the Repository

```bash
git clone https://github.com/Core-Foundry/Notify-Chain.git
cd Notify-Chain
```

If you plan to contribute, fork the repository first, then clone your fork:

```bash
git clone https://github.com/YOUR-USERNAME/Notify-Chain.git
cd Notify-Chain
git remote add upstream https://github.com/Core-Foundry/Notify-Chain.git
```

---

## 3. Listener Service Setup

The listener is the core off-chain service that polls the Stellar network, processes contract events, and delivers notifications.

### 3.1 Install Dependencies

```bash
cd listener
npm install
```

> **Note**: The `sqlite3` package includes native bindings. If the install fails, see the [Troubleshooting](#9-troubleshooting--faq) section.

### 3.2 Configure Environment

```bash
cp .env.example .env
```

Open `listener/.env` in your editor. At minimum, set:

```bash
STELLAR_RPC_URL=https://soroban-testnet.stellar.org:443
CONTRACT_ADDRESSES=[{"address":"YOUR_CONTRACT_ID","events":["*"]}]
```

For a full reference of every variable, see [Environment Variables Reference](#6-environment-variables-reference).

### 3.3 Initialize the Database

```bash
npm run migrate
```

This creates the SQLite database file (default location: `listener/data/notifications.db`) and runs all schema migrations.

### 3.4 Run the Listener

```bash
npm run dev
```

The listener starts and immediately begins polling the configured contracts. You should see log output showing poll cycles.

**Verify it's running:**

```bash
curl http://localhost:8787/health        # Health check
curl http://localhost:8787/api/events    # Event feed (may be empty initially)
```

### 3.5 Useful Listener Commands

| Command                 | Purpose                                          |
|-------------------------|--------------------------------------------------|
| `npm run dev`           | Start in development mode (ts-node, hot reload)  |
| `npm run build`         | Compile TypeScript to JavaScript                 |
| `npm start`             | Run the compiled production build                |
| `npm test`              | Run all tests                                    |
| `npm run typecheck`     | TypeScript type checking (no emit)               |
| `npm run migrate`       | Initialize or update the SQLite database schema  |
| `npm run lint`          | Alias for `typecheck`                            |

---

## 4. Dashboard Setup

The dashboard is a React + Vite application that visualizes events from the listener's API.

### 4.1 Install Dependencies

```bash
cd dashboard
npm install
```

### 4.2 Configure Environment

```bash
cp .env.example .env
```

The default `.env.example` is pre-configured for local development:

```bash
VITE_EVENTS_API_URL=http://localhost:8787/api/events
VITE_STELLAR_NETWORK=TESTNET
```

Change `VITE_EVENTS_API_URL` if your listener runs on a different port.

### 4.3 Run the Dashboard

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. The dashboard fetches events from the listener API and displays them in real-time.

### 4.4 Useful Dashboard Commands

| Command          | Purpose                                          |
|------------------|--------------------------------------------------|
| `npm run dev`    | Start Vite dev server with hot module replacement |
| `npm run build`  | TypeScript check + Vite production build          |
| `npm test`       | Run all tests                                    |
| `npm run lint`   | ESLint with zero-tolerance for warnings           |
| `npm run preview` | Preview the production build locally             |
| `npm run benchmark` | Run performance rendering benchmarks           |

---

## 5. Smart Contracts Setup

The project contains two Soroban smart contracts. Building them is optional — you only need to do this if you are modifying contracts or deploying your own instances.

### 5.1 Build Contracts

**AutoShare Contract** (`contract/`):

```bash
cd contract
stellar contract build
```

The compiled `.wasm` file is written to `contract/target/wasm32-unknown-unknown/release/`.

**TaskBounty Contract** (`Documents/Task Bounty/`):

```bash
cd Documents/Task\ Bounty
stellar contract build
```

### 5.2 Run Contract Tests

```bash
# AutoShare
cd contract/contracts/hello-world
cargo test

# TaskBounty
cd Documents/Task\ Bounty
cargo test
```

### 5.3 Deploy to Testnet (Optional)

This requires a funded Stellar testnet identity:

```bash
# Generate and fund a test identity
stellar keys generate my-identity --network testnet
stellar keys fund my-identity --network testnet

# Deploy the AutoShare contract
cd contract
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/hello_world.wasm \
  --source my-identity \
  --network testnet

# The contract ID is printed after successful deployment
```

### 5.4 Useful Contract Commands

| Command                                          | Purpose                     |
|--------------------------------------------------|-----------------------------|
| `stellar contract build`                         | Build all contracts         |
| `cargo test`                                     | Run contract tests          |
| `stellar contract deploy --wasm <FILE> --source <ID> --network testnet` | Deploy to testnet |
| `stellar contract invoke --id <ID> --source <ID> --network testnet -- <FUNCTION> [ARGS]` | Call a contract function |
| `stellar contract optimize --wasm <FILE>`         | Optimize Wasm for production |
| `stellar contract inspect --wasm <FILE>`          | Inspect contract interface  |
| `cargo fmt --all`                                 | Format Rust code            |

---

## 6. Environment Variables Reference

### 6.1 Listener (`listener/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **Stellar Network** | | | |
| `STELLAR_NETWORK` | No | `testnet` | Network passphrase (`testnet`, `pubnet`, or custom) |
| `STELLAR_RPC_URL` | **Yes** | `https://soroban-testnet.stellar.org:443` | Soroban RPC endpoint to poll for events |
| **Contracts** | | | |
| `CONTRACT_ADDRESSES` | **Yes** | `[]` | JSON array of contract configs. Format: `[{"address":"C...","events":["*"]}]`. Each entry has `address` (string, the Stellar contract ID) and `events` (string array of event names to filter on, or `["*"]` for all). |
| **Polling** | | | |
| `POLL_INTERVAL_MS` | No | `30000` | Time between RPC polls (milliseconds) |
| `MAX_RECONNECT_ATTEMPTS` | No | `5` | Max consecutive RPC failures before stopping |
| `RECONNECT_DELAY_MS` | No | `5000` | Base delay between reconnection attempts (exponential backoff) |
| **API Server** | | | |
| `EVENTS_API_PORT` | No | `8787` | HTTP server port for `/health` and `/api/events` |
| `EVENTS_API_CORS_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin (dashboard URL) |
| `WEBHOOK_SECRETS` | No | `[]` | JSON array of webhook secrets for HMAC verification. Format: `[{"id":"default","secret":"whsec_..."}]` |
| **Discord Notifications** | | | |
| `DISCORD_WEBHOOK_URL` | No | — | Discord webhook URL for sending notifications |
| `DISCORD_WEBHOOK_ID` | No | — | Discord webhook ID (required if webhook URL is set) |
| **Retry Queue** | | | |
| `RETRY_BASE_DELAY_MS` | No | `5000` | Base delay for notification retry exponential backoff |
| `RETRY_MAX_RETRIES` | No | `5` | Max retry attempts for failed Discord notifications |
| **Event Processing Queue** | | | |
| `EVENT_QUEUE_MAX_CONCURRENCY` | No | `1` | Max events to process concurrently (1 = ordered) |
| `EVENT_QUEUE_MAX_RETRIES` | No | `3` | Max retry attempts per event before permanent failure |
| `EVENT_QUEUE_BASE_DELAY_MS` | No | `2000` | Base delay for event retry exponential backoff |
| `EVENT_QUEUE_POLL_INTERVAL_MS` | No | `1000` | How often the queue checks for due events (ms) |
| **Database** | | | |
| `DATABASE_PATH` | No | `./data/notifications.db` | SQLite database file path |
| **Scheduler** | | | |
| `SCHEDULER_ENABLED` | No | `true` | Enable the notification scheduler |
| `SCHEDULER_POLL_INTERVAL_MS` | No | `10000` | How often the scheduler polls for due notifications |
| `SCHEDULER_LOCK_TIMEOUT_MS` | No | `60000` | Distributed lock timeout for scheduler |
| `SCHEDULER_PROCESSOR_ID` | No | auto-generated | Unique ID for this scheduler instance (multi-instance setups) |
| `SCHEDULER_BATCH_SIZE` | No | `10` | Max notifications to process per poll cycle |
| `SCHEDULER_TIMING_BUFFER_MS` | No | `60000` | Buffer to prevent premature notification delivery |
| **Rate Limiting** | | | |
| `RATE_LIMIT_ENABLED` | No | `true` | Enable HTTP API rate limiting |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (milliseconds) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `60` | Max requests per window per client |
| `RATE_LIMIT_CLIENT_OVERRIDES` | No | `{}` | JSON object of per-client rate limit overrides |
| **Cleanup** | | | |
| `CLEANUP_INTERVAL_MS` | No | `3600000` | How often to run cleanup jobs (1 hour) |
| `NOTIFICATION_RETENTION_MS` | No | `604800000` | Retain completed notifications (7 days) |
| `RATE_LIMIT_EVENT_RETENTION_MS` | No | `86400000` | Retain rate limit audit events (1 day) |
| `EVENT_RETENTION_MS` | No | `86400000` | Retain in-memory events (1 day) |
| **Logging** | | | |
| `LOG_LEVEL` | No | `info` | Winston log level (`error`, `warn`, `info`, `debug`) |
| `NODE_ENV` | No | — | Set to `production` for newline-delimited JSON log output |

### 6.2 Dashboard (`dashboard/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_EVENTS_API_URL` | No | `http://localhost:8787/api/events` | Listener API endpoint for fetching events |
| `VITE_STELLAR_NETWORK` | No | `TESTNET` | Stellar network for wallet integration (`TESTNET` or `MAINNET`) |

### 6.3 Minimum Viable Configuration

To run the listener with no optional features:

```bash
STELLAR_RPC_URL=https://soroban-testnet.stellar.org:443
CONTRACT_ADDRESSES=[{"address":"C...","events":["*"]}]
EVENTS_API_PORT=8787
EVENTS_API_CORS_ORIGIN=http://localhost:5173
```

To add Discord notifications, also set:

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_TOKEN
```

---

## 7. Running Tests

Always run tests before submitting a pull request.

### Contracts

```bash
# AutoShare
cd contract/contracts/hello-world && cargo test

# TaskBounty
cd Documents/Task\ Bounty && cargo test
```

### Listener

```bash
cd listener
npm test
```

### Dashboard

```bash
cd dashboard
npm test
```

### CI Validation (What GitHub Actions Runs)

The CI pipeline executes these checks on every pull request:

```bash
# Listener
cd listener
npm run typecheck   # TypeScript strict type checking
npm test            # Jest test suite

# Dashboard
cd dashboard
npm run lint        # ESLint (zero warnings)
npm run build       # TypeScript check + Vite build
npm test            # Jest test suite

# Contracts
cd contract
cargo fmt --all -- --check   # Rust formatting check
cargo test --workspace --all-features --verbose
```

---

## 8. VS Code Setup (Recommended)

### Extensions

Install these VS Code extensions:

1. [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) — Rust language support
2. [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) — Debugger for Rust
3. [Better TOML](https://marketplace.visualstudio.com/items?itemName=bungcip.better-toml) — TOML file support
4. [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) — TypeScript linting
5. [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) — Code formatter

### Settings

Add this to `.vscode/settings.json` (already present in the repository):

```json
{
  "rust-analyzer.cargo.target": "wasm32-unknown-unknown",
  "rust-analyzer.checkOnSave.allTargets": false
}
```

This configures `rust-analyzer` to use the `wasm32` target and avoids false-positive type errors from non-Wasm platform checks.

---

## 9. Troubleshooting & FAQ

> A more extensive troubleshooting guide is available at [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). This section covers the most common setup issues.

### Node.js & npm

**Q: `npm install` fails with `node-gyp` or `sqlite3` errors.**

Native `sqlite3` bindings must be compiled for your platform and Node.js version.

```bash
# Rebuild native bindings
npm rebuild sqlite3

# If that fails, reinstall
npm uninstall sqlite3 && npm install
```

On Windows, ensure you have Visual Studio Build Tools installed with the "C++ build tools" workload.

---

**Q: Which Node.js version should I use?**

The listener CI runs on Node 20, the dashboard CI runs on Node 18. Use **Node 20** for local development (it is forward-compatible with the dashboard). Use `nvm` to switch if needed.

---

### Stellar RPC & Network

**Q: The listener starts but no events appear.**

1. Verify the contract ID in `CONTRACT_ADDRESSES` is correct and deployed on the same network as `STELLAR_RPC_URL`.
2. Confirm the RPC endpoint is reachable:
   ```bash
   curl -X POST https://soroban-testnet.stellar.org:443 -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```
3. Check listener logs for poll cycle output:
   ```bash
   cd listener && npm run dev
   ```
   Look for lines containing `"Received events"` or `"Processing event"`.
4. Verify the API is responding:
   ```bash
   curl http://localhost:8787/health
   curl http://localhost:8787/api/events
   ```

---

**Q: `stellar: command not found`**

```bash
# Ensure cargo's bin directory is in your PATH
source "$HOME/.cargo/env"

# Or reinstall
cargo install --locked stellar-cli --features opt
```

---

### Database

**Q: `Error: Database not initialized` or `SQLITE_ERROR: no such table`**

```bash
cd listener
npm run migrate
```

If the data directory is missing:

```bash
mkdir -p listener/data
npm run migrate
```

---

### Port Conflicts

**Q: `EADDRINUSE: address already in use :::8787`**

```bash
# Find the process using the port (macOS/Linux)
lsof -i :8787
kill -9 <PID>

# Or change the port in listener/.env
EVENTS_API_PORT=8788
```

---

### Dashboard

**Q: Dashboard shows a blank page or "Failed to fetch"**

1. Is the listener running? (`npm run dev` in `listener/`)
2. Does `VITE_EVENTS_API_URL` in `dashboard/.env` match the listener's port?
3. Restart the Vite dev server after editing `.env`.

---

### Contracts

**Q: `error: toolchain 'stable' does not support target 'wasm32-unknown-unknown'`**

```bash
rustup target add wasm32-unknown-unknown
```

---

**Q: `error[E0463]: can't find crate for 'std'`**

Build with the correct target:

```bash
cargo build --target wasm32-unknown-unknown --release
# Or use Stellar CLI (handles the target automatically):
stellar contract build
```

---

### After a `git pull`

If things stop working after pulling latest changes:

```bash
# Contracts
cd contract && stellar contract build

# Listener
cd listener && npm install && npm run migrate

# Dashboard
cd dashboard && npm install
```

---

### Still Stuck?

1. Search [open issues](https://github.com/Core-Foundry/Notify-Chain/issues) — your problem may already be reported.
2. Read the detailed [Troubleshooting Guide](TROUBLESHOOTING.md).
3. Open a new issue with:
   - Your OS and version
   - Output of `rustc --version`, `node --version`, `stellar --version`
   - The full error message and stack trace
   - Steps you have already tried

---

## Project Map

```
Notify-Chain/
├── contract/                          # Soroban smart contract workspace
│   ├── contracts/hello-world/         #  AutoShare contract (active)
│   └── Cargo.toml                     # Workspace configuration
│
├── listener/                          #  Off-chain listener service
│   ├── src/
│   │   ├── api/                       # HTTP API (events, health, templates)
│   │   ├── services/                  # Core: subscriber, dedup, notifier, scheduler
│   │   ├── store/                     # In-memory event registry + preferences
│   │   ├── database/                  # SQLite schema and client
│   │   ├── types/                     # TypeScript type definitions
│   │   ├── utils/                     # Logging, formatting, helpers
│   │   └── index.ts                   # Entry point
│   └── src/__tests__/                 # Integration / E2E tests
│
├── dashboard/                         #  React + Vite event dashboard
│   └── src/
│       ├── components/                # UI components (EventCard, filters, etc.)
│       ├── services/                  # API client
│       ├── store/                     # Zustand state management
│       └── pages/                     # Page components
│
├── Documents/Task Bounty/             #  TaskBounty contract (Soroban)
│
├── frontend/                          # Legacy Next.js frontend (not actively maintained)
│
├── scripts/                           # Helper scripts (health check, etc.)
│
├── CONTRIBUTOR_SETUP.md               #  This file
├── CONTRIBUTING.md                    # Contribution guidelines & PR workflow
├── TROUBLESHOOTING.md                 # Detailed troubleshooting reference
├── ARCHITECTURE_OVERVIEW.md           # High-level architecture walkthrough
└── README.md                          # Project overview and quick start
```
