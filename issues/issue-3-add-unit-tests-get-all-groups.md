---
labels: good first issue, testing
title: Add unit tests for `get_all_groups` function
---

## Description
The smart contract has a `get_all_groups` function in `autoshare_logic.rs` that retrieves all active groups. However, there are currently no unit tests specifically verifying its behavior under different conditions (e.g., when no groups exist vs when multiple exist).

## Task
1. Open `contract/contracts/hello-world/src/tests/autoshare_test.rs` (or similar test file).
2. Write a new test function `test_get_all_groups()`.
3. The test should initialize the contract, create a few AutoShare groups, and then assert that `get_all_groups` returns the correct array of groups.

## Expected Outcome
A pull request with the new unit test added and passing when `cargo test` is run.
