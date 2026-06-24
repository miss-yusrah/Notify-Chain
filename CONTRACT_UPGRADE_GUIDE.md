# Smart Contract Upgrade Guide

This guide describes a repeatable, contributor-friendly workflow for upgrading
NotifyChain smart contracts without losing reviewability or deployment safety.
It is written for the active Soroban workspaces in this repository:

- `contract/contracts/hello-world/` for the AutoShare contract.
- `Documents/Task Bounty/` for the TaskBounty contract.

Use this guide before changing contract storage, public methods, emitted events,
authorization rules, or deployment artifacts.

## Upgrade Goals

A contract upgrade should make one intentional change at a time and leave a
review trail that maintainers can audit later. Every upgrade PR should answer:

- What contract behavior changes?
- Which storage keys, events, or public methods are affected?
- How can reviewers reproduce the build and tests?
- How can a deployer verify the new Wasm before and after deployment?
- What is the rollback or fallback plan if verification fails?

## Prerequisites

Install the standard Soroban toolchain:

```bash
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt
```

Verify the tools:

```bash
rustc --version
cargo --version
stellar --version
```

For testnet deployment checks, create and fund a test identity:

```bash
stellar keys generate test-upgrade --network testnet
stellar keys fund test-upgrade --network testnet
```

Keep mainnet deployment keys, hardware wallets, passphrases, and any signing
material out of this repository and out of PR comments.

## 1. Scope the Upgrade

Before editing code, identify the target contract and write down the smallest
reviewable scope.

For AutoShare:

```bash
cd contract/contracts/hello-world
```

For TaskBounty:

```bash
cd "Documents/Task Bounty"
```

Check the relevant files:

- `src/lib.rs` for exported contract methods.
- `src/base/types.rs` or `src/types.rs` for persisted data structures.
- `src/base/events.rs` or `src/events.rs` for event shapes.
- Existing tests under `src/tests/` or `src/test.rs`.
- README, API, setup, and workflow docs that mention the changed behavior.

Classify the change before implementation:

| Change type | Examples | Required review focus |
| --- | --- | --- |
| Public API | New method, removed method, changed arguments | Client compatibility and README/API updates |
| Storage shape | New key, renamed key, changed struct field | Migration path and old-state handling |
| Event schema | New event, renamed field, removed field | Listener/dashboard compatibility |
| Authorization | Admin checks, pause checks, role changes | Access-control tests and misuse cases |
| Deployment config | Wasm path, network, initialization args | Reproducible commands and verification |

If more than one row changes, consider splitting the work into smaller PRs.

## 2. Create an Upgrade Branch

Use a branch name that includes the target contract and issue number:

```bash
git checkout -b docs/contract-upgrade-guide-140
```

For code upgrades, prefer:

```bash
git checkout -b contract/autoshare-upgrade-<issue-number>
git checkout -b contract/taskbounty-upgrade-<issue-number>
```

## 3. Implement the Change

Keep the implementation localized:

- Update the contract module that owns the behavior.
- Add or update tests next to the affected contract.
- Update docs in the same PR when public behavior, events, or setup steps
  change.
- Avoid unrelated formatting, generated files, and dependency upgrades.

When changing storage, document how old state is handled. Soroban contracts do
not automatically migrate historical state for you, so reviewers need to know
whether the new code:

- reads existing keys without modification,
- introduces optional/defaulted fields,
- writes new keys only after the next successful method call, or
- requires a new deployment instead of an in-place upgrade.

## 4. Build and Test Locally

Run contract checks from the workspace that changed.

AutoShare:

```bash
cd contract/contracts/hello-world
cargo fmt --all
cargo test
stellar contract build
```

TaskBounty:

```bash
cd "Documents/Task Bounty"
cargo fmt --all
cargo test
stellar contract build
```

If a top-level workspace command is more appropriate for the PR, include it in
the PR description with the exact directory where it was run.

## 5. Inspect the Wasm Artifact

Record the Wasm path and hash before deployment checks. This gives reviewers a
stable artifact reference.

```bash
find . -path "*target*" -name "*.wasm" -type f
sha256sum target/wasm32v1-none/release/*.wasm
```

Inspect the contract interface:

```bash
stellar contract inspect --wasm target/wasm32v1-none/release/*.wasm
```

Confirm that exported functions, event names, and argument types match the
intended change. If the inspect output differs from the PR description, stop
and fix the code or docs before opening the PR.

## 6. Deploy to Testnet for Verification

Use testnet for upgrade rehearsals. Do not use production keys in local testing
or PR evidence.

Deploy a fresh testnet instance when the change is not backward compatible:

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/<contract>.wasm \
  --source test-upgrade \
  --network testnet
```

Save the returned contract ID:

```bash
export CONTRACT_ID=<returned-contract-id>
```

Initialize the contract with test-only values, then invoke the changed method
or the closest verification path.

For a contract that supports admin initialization:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source test-upgrade \
  --network testnet \
  -- \
  initialize_admin \
  --admin <TESTNET_ADMIN_ADDRESS>
```

For TaskBounty-style initialization:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source test-upgrade \
  --network testnet \
  -- \
  initialize \
  --dispute_resolver <TESTNET_RESOLVER_ADDRESS> \
  --admin <TESTNET_ADMIN_ADDRESS>
```

Use placeholder values in documentation and PR comments. Never paste private
keys, seeds, live account credentials, or production secrets.

## 7. Verification Checklist

Before requesting review, confirm:

- `cargo fmt --all` was run for the changed contract workspace.
- `cargo test` passes for the changed contract.
- `stellar contract build` produces a Wasm artifact.
- `stellar contract inspect` output matches the documented interface.
- Any changed event schema is reflected in listener or dashboard docs.
- Any changed public method is reflected in README/API docs.
- Authorization and pause behavior are tested for success and failure paths.
- PR body includes exact commands, directory names, and results.

For docs-only upgrade guidance, verify:

- All referenced paths exist.
- Commands match the current repository layout.
- No production secrets, private keys, or wallet recovery phrases are included.

## 8. Rollback and Fallback Procedures

Rollback depends on the type of upgrade.

### Documentation or Client-Only Issue

Revert the PR or follow up with a corrective docs PR. No contract state changes
are involved.

### Failed Testnet Deployment

Do not promote the artifact. Open a follow-up issue with:

- the failing command,
- the contract ID if one was created,
- the Wasm hash,
- observed error output,
- the suspected failure class.

Then return to the previous known-good commit and rebuild.

### Failed Mainnet Readiness Check

Stop before signing any mainnet transaction. Re-run the testnet verification
checklist with a fresh test identity and require maintainer review before
continuing.

### Post-Deployment Regression

If a deployed contract has a regression:

1. Pause affected flows if the contract exposes a pause/admin control.
2. Announce the affected contract ID, network, and user-visible impact.
3. Preserve the failing Wasm hash and transaction IDs for audit.
4. Deploy a corrected contract or restore clients to the previous contract ID,
   depending on the integration model.
5. Document the incident and add regression tests before resuming normal use.

## 9. PR Template for Contract Upgrades

Use this structure in upgrade PRs:

```markdown
## Summary
- What changed
- Which contract/workspace changed
- Linked issue

## Compatibility
- Public methods changed:
- Storage keys or persisted data changed:
- Event schema changed:
- Client/listener/dashboard impact:

## Verification
- Directory:
- Commands run:
- Wasm path:
- Wasm sha256:
- `stellar contract inspect` reviewed:

## Rollback
- Safe fallback:
- Conditions that should stop deployment:

Closes #<issue-number>
```

## Related Documentation

- [Project README](README.md)
- [Root contributing guide](CONTRIBUTING.md)
- [AutoShare contract workspace](contract/)
- [TaskBounty setup guide](Documents/Task%20Bounty/SETUP.md)
- [TaskBounty architecture](Documents/Task%20Bounty/ARCHITECTURE.md)
- [TaskBounty workflows](Documents/Task%20Bounty/WORKFLOWS.md)
