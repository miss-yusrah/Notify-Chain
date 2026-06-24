---
labels: good first issue, ci
title: Add GitHub Actions workflow for running tests
---

## Description
Currently, contributors have to manually run `cargo test` locally to ensure their changes didn't break anything. Setting up a GitHub Actions workflow that runs our test suite on every pull request will automate our continuous integration and catch bugs early.

## Task
1. Create a `.github/workflows/test.yml` file in the root of the repository.
2. Add a simple workflow that triggers on `push` and `pull_request` to the `main` branch.
3. The workflow should checkout the code, install the stable Rust toolchain, and run `cargo test` in the `contract/contracts/hello-world` directory.

## Expected Outcome
A pull request containing the new `.github/workflows/test.yml` file, which successfully runs and passes when opened.
