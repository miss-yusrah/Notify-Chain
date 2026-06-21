# NotifyChain

> A contract + off-chain helper system for tracking blockchain events and delivering real-time notifications.

## Overview

NotifyChain is an open-source event monitoring and notification system designed for smart contracts. It combines on-chain event emission with an off-chain listener service to track contract activity and trigger custom actions such as notifications, webhooks, emails, or integrations with external applications.

The project enables developers to build reactive decentralized applications without continuously polling the blockchain.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Event Flow](#event-flow)
4. [Local Development Guide](#local-development-guide)
5. [Features](#features)
6. [Use Cases](#use-cases)
7. [Tech Stack](#tech-stack)
8. [Contributing](#contributing)
9. [License](#license)

> **Listener service docs**: [Notification Failure Recovery](NOTIFICATION_FAILURE_RECOVERY.md) — retry lifecycle, configuration, and troubleshooting.

---

## Architecture Overview

NotifyChain is built from three cooperating layers. On-chain contracts emit
events, an off-chain listener turns those events into notifications and a
queryable feed, and a dashboard renders that feed for humans. Each layer can be
run and developed independently.

| Component | Location | Tech | Responsibility |
|-----------|----------|------|----------------|
| **Smart Contracts** | `contract/`, `Documents/Task Bounty/` | Soroban / Rust | Execute business logic and emit a structured event for every important state change |
| **Listener Service** | `listener/` | Node.js / TypeScript | Poll the Stellar network for contract events, deduplicate them, push notifications, and expose an HTTP events API |
| **Dashboard** | `dashboard/` | React + Vite | Fetch the listener's events API and display real-time contract activity |

### How the Components Interact

```
        On-chain                         Off-chain
 ┌────────────────────┐         ┌──────────────────────────────┐
 │  Soroban Contracts │         │        Listener Service       │
 │  (TaskBounty,      │  emit   │  ┌────────────────────────┐   │
 │   AutoShare)       │ ──────► │  │ EventSubscriber (poll) │   │
 │                    │ events  │  └───────────┬────────────┘   │
 └────────────────────┘         │              ▼                │
            ▲                    │  ┌────────────────────────┐  │
            │ invoke             │  │ Deduplicator + Registry │ │
            │                    │  └───────────┬────────────┘  │
 ┌────────────────────┐         │      ┌────────┴────────┐      │
 │   Users / dApps    │         │      ▼                 ▼      │
 └────────────────────┘         │  Discord         /api/events  │
                                │  webhook          HTTP API     │
                                └──────────────────────┬─────────┘
                                                       │ fetch
                                                       ▼
                                            ┌────────────────────┐
                                            │  React Dashboard   │
                                            └────────────────────┘
```

> A high-level, contributor-facing architecture guide lives in
> [`ARCHITECTURE_OVERVIEW.md`](ARCHITECTURE_OVERVIEW.md). It walks new
> contributors through the on-chain, off-chain, and dashboard layers,
> the end-to-end data flow, and links out to every subsystem doc.
>
> A more detailed, contract-level architecture write-up lives in
> [`Documents/Task Bounty/ARCHITECTURE.md`](Documents/Task%20Bounty/ARCHITECTURE.md).

### Contract Responsibilities

The on-chain layer is the source of truth. Each contract owns its own state and
emits typed events (see [Event Flow](#event-flow)) that the off-chain layer
consumes. Two example contracts ship with the project:

#### 1. TaskBounty Contract (`Documents/Task Bounty/`)

A decentralized task and reward board that allows users to:
- Create tasks with escrowed rewards
- Submit work
- Approve/reject submissions
- Raise disputes
- Manage payouts automatically

Key Modules:
- `types.rs`: Data structures and enums
- `storage.rs`: Storage access patterns
- `task.rs`: Task creation and management
- `submission.rs`: Work submission handling
- `dispute.rs`: Dispute resolution
- `events.rs`: Event emission

#### 2. AutoShare Contract (`contract/contracts/hello-world/`)

A subscription and group management contract that allows users to:
- Create sharing groups
- Manage group members
- Handle subscription payments
- Track usage
- Admin management
- Expose contract version for verification

Key Modules:
- `base/types.rs`: Data structures
- `base/errors.rs`: Error definitions
- `base/events.rs`: Event emission
- `interfaces/autoshare.rs`: Interface definitions
- `autoshare_logic.rs`: Core business logic
- `mock_token.rs`: Mock token for testing
- `tests/`: Comprehensive test suite

---

## Project Structure

```
Notify-Chain/
├── contract/                          # Soroban contract workspace
│   ├── contracts/
│   │   └── hello-world/               # AutoShare contract implementation
│   │       ├── src/
│   │       │   ├── base/
│   │       │   │   ├── errors.rs     # Error definitions
│   │       │   │   ├── events.rs     # Event types
│   │       │   │   └── types.rs      # Data structures
│   │       │   ├── interfaces/
│   │       │   │   └── autoshare.rs  # Interfaces
│   │       │   ├── tests/
│   │       │   │   ├── autoshare_test.rs
│   │       │   │   ├── mock_token_test.rs
│   │       │   │   ├── pause_test.rs
│   │       │   │   ├── test_utils.rs
│   │       │   │   └── test_utils_test.rs
│   │       │   ├── autoshare_logic.rs # Core contract logic
│   │       │   ├── lib.rs            # Contract entry point
│   │       │   └── mock_token.rs     # Mock token for testing
│   │       ├── Cargo.toml
│   │       ├── Makefile
│   │       └── build_log.txt
│   ├── Cargo.toml                    # Workspace configuration
│   └── README.md
├── listener/                         # Off-chain listener service (Node + TS)
│   └── src/
│       ├── api/                      # Events HTTP API (/api/events, /health)
│       ├── services/                 # Subscriber, deduplicator, Discord notifier
│       ├── store/                    # In-memory event registry
│       ├── utils/                    # Logging, formatting, helpers
│       └── index.ts                  # Service entry point
├── dashboard/                        # Real-time event dashboard (React + Vite)
│   └── src/
│       ├── components/               # Event list / card / filter UI
│       ├── services/                 # Events API client
│       └── store/                    # Client-side event store (Zustand)
├── Documents/
│   ├── Task Bounty/                  # TaskBounty contract and docs
│   │   ├── src/
│   │   │   ├── dispute.rs
│   │   │   ├── events.rs
│   │   │   ├── lib.rs
│   │   │   ├── storage.rs
│   │   │   ├── submission.rs
│   │   │   ├── task.rs
│   │   │   ├── test.rs
│   │   │   └── types.rs
│   │   ├── API.md
│   │   ├── ARCHITECTURE.md
│   │   ├── CONTRIBUTING.md
│   │   ├── PROJECT_CHECKLIST.md
│   │   ├── PROJECT_OVERVIEW.md
│   │   ├── README.md
│   │   ├── SETUP.md
│   │   ├── SUMMARY.md
│   │   ├── WORKFLOWS.md
│   │   └── Cargo.toml
│   └── Stellar-save/
├── .vscode/
│   └── settings.json
├── README.md                        # This file
├── ARCHITECTURE_OVERVIEW.md         # High-level architecture guide (issue #137)
└── .gitignore
```

---

## Event Flow

### End-to-End Notification Flow

This is how a single on-chain action becomes a delivered notification:

```
1. A user invokes a contract function (e.g. create_task)
   ↓
2. The contract updates state and emits a typed event
   ↓
3. The listener's EventSubscriber polls the Stellar RPC and picks up the event
   ↓
4. The event is validated, parsed, and recorded in the in-memory event registry
   ↓
5. The deduplicator drops events already seen (by contract + event id)
   ↓
6. A Discord notification is sent (if a webhook is configured)
   ↓
7. The dashboard fetches GET /api/events and renders the new activity
```

Key pieces of the off-chain pipeline:

- **`EventSubscriber`** (`listener/src/services/event-subscriber.ts`) polls the
  configured contracts on an interval and reconnects on failure.
- **`NotificationDeduplicator`** (`listener/src/services/notification-deduplicator.ts`)
  prevents the same event from being notified twice.
- **`DiscordNotificationService`** (`listener/src/services/discord-notification.ts`)
  formats and delivers notifications.
- **Events API** (`listener/src/api/events-server.ts`) exposes `GET /api/events`
  for the dashboard and `GET /health` for monitoring.

The contract events that drive this flow are listed below.

### 1. TaskBounty Contract Events

| Event | Trigger | Data Included |
|-------|---------|---------------|
| `TaskCreated` | When a new task is created | Task ID, Poster address, Title, Reward, Deadline |
| `WorkSubmitted` | When work is submitted for a task | Task ID, Submission ID, Contributor, Work URL |
| `SubmissionApproved` | When a submission is approved | Task ID, Submission ID, Contributor, Reward |
| `SubmissionRejected` | When a submission is rejected | Task ID, Submission ID, Contributor |
| `TaskCancelled` | When a task is cancelled | Task ID, Poster address |
| `DisputeRaised` | When a dispute is raised | Task ID, Submission ID, Raiser, Reason |

#### Example Event Flow (Task Creation → Submission → Approval)

```
1. Poster calls create_task()
   ↓
2. Contract escrows reward tokens
   ↓
3. Contract emits TaskCreated event
   ↓
4. Contributor calls submit_work()
   ↓
5. Contract emits WorkSubmitted event
   ↓
6. Poster calls approve_submission()
   ↓
7. Contract transfers reward to contributor
   ↓
8. Contract emits SubmissionApproved event
```

### 2. AutoShare Contract Events

| Event | Trigger | Data Included |
|-------|---------|---------------|
| `AutoshareCreated` | When a new AutoShare group is created | Creator address, Group ID |
| `AutoshareUpdated` | When a group is updated | Updater address, Group ID |
| `ContractPaused` | When the contract is paused | N/A |
| `ContractUnpaused` | When the contract is unpaused | N/A |
| `GroupDeactivated` | When a group is deactivated | Creator address, Group ID |
| `GroupActivated` | When a group is activated | Creator address, Group ID |
| `AdminTransferred` | When admin rights are transferred | Old admin, New admin |
| `Withdrawal` | When tokens are withdrawn | Token address, Recipient, Amount |

---

## Local Development Guide

### Prerequisites

Before getting started, make sure you have the following installed:

1. **Rust**: The programming language used for Soroban contracts
2. **WebAssembly Target**: For compiling to Wasm
3. **Stellar CLI**: For interacting with Soroban contracts

#### Installing Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

Verify installation:
```bash
rustc --version
cargo --version
```

#### Adding WebAssembly Target

```bash
rustup target add wasm32-unknown-unknown
```

#### Installing Stellar CLI

```bash
cargo install --locked stellar-cli --features opt
```

Verify installation:
```bash
stellar --version
```

### Setting Up the Project

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/notify-chain.git
   cd notify-chain
   ```

2. **Building the AutoShare contract**:
   ```bash
   cd contract
   stellar contract build
   ```

3. **Running tests for AutoShare contract**:
   ```bash
   cd contracts/hello-world
   cargo test
   ```

4. **Building the TaskBounty contract**:
   ```bash
   cd ../../Documents/Task\ Bounty
   cargo build --target wasm32-unknown-unknown --release
   # Or using Stellar CLI:
   stellar contract build
   ```

5. **Running tests for TaskBounty contract**:
   ```bash
   cargo test
   ```

### Using Stellar CLI

#### 1. Generate a Test Identity

```bash
stellar keys generate test-user --network testnet
```

#### 2. Fund Your Identity with Test XLM

```bash
stellar keys fund test-user --network testnet
```

#### 3. Deploy a Contract to Testnet

```bash
cd contract/contracts/hello-world
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/hello_world.wasm \
  --source test-user \
  --network testnet
```

#### 4. Initialize the Contract

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source test-user \
  --network testnet \
  -- \
  initialize_admin \
  --admin <ADMIN_ADDRESS>
```

### Useful Commands

| Command | Purpose |
|---------|---------|
| `stellar contract build` | Build a contract |
| `cargo test` | Run tests |
| `stellar contract deploy` | Deploy a contract |
| `stellar contract invoke` | Call a contract function |
| `stellar contract optimize` | Optimize contract for deployment |
| `stellar keys list` | List your identities |

### IDE Setup (VS Code)

Install the following extensions for a smooth development experience:

1. [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) - Rust language support
2. [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) - Debugger
3. [Better TOML](https://marketplace.visualstudio.com/items?itemName=bungcip.better-toml) - TOML file support

Add this to `.vscode/settings.json`:
```json
{
  "rust-analyzer.cargo.target": "wasm32-unknown-unknown",
  "rust-analyzer.checkOnSave.allTargets": false
}
```

---

## Features

* 📡 Real-time blockchain event monitoring
* 🔗 Smart contract event emission
* ⚡ Off-chain listener service
* 🔔 Custom notification triggers
* 🌐 Webhook support for external integrations
* 📝 Event logging and processing
* 🛠️ Easy integration into existing dApps
* 🔒 Trustless and transparent event tracking

---

## Use Cases

* Task completion notifications
* Escrow payment updates
* NFT mint alerts
* DAO proposal events
* Bounty submissions
* Token transfers
* Marketplace purchases
* Governance voting updates
* DeFi protocol monitoring
* Custom application events

---

## Tech Stack

### Smart Contracts

* **Soroban** (Stellar smart contracts)
* **Rust**

### Off-chain Services

* Node.js
* TypeScript
* Stellar SDK
* React + Vite (dashboard)

### Notification Providers

* Discord (implemented)
* Email, Telegram, Slack, Webhooks, Push Notifications (planned)

---

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to your branch
5. Open a Pull Request

Please follow the project's coding standards and include tests where applicable.

For more detailed contribution guidelines, check:
- `Documents/Task Bounty/CONTRIBUTING.md`

---

## License

This project is licensed under the MIT License.

---

## Acknowledgements

NotifyChain is built to simplify event-driven blockchain development by bridging smart contract events with off-chain automation and notification systems.

Built on [Stellar](https://www.stellar.org/) and [Soroban](https://soroban.stellar.org/).
