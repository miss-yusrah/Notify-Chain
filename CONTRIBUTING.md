# Contributing to NotifyChain

Thank you for your interest in contributing to NotifyChain! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other contributors

## Getting Started

### Prerequisites

To contribute to NotifyChain, make sure you have:
- [Rust](https://www.rust-lang.org/tools/install) installed with WebAssembly target (`rustup target add wasm32-unknown-unknown`)
- [Stellar CLI](https://developers.stellar.org/docs/build/sdks-and-libraries/cli/) installed
- [Node.js](https://nodejs.org/) (for listener and dashboard components)
- Basic understanding of Soroban smart contracts, Git, and GitHub

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/Notify-Chain.git
   cd Notify-Chain
   ```
3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/Core-Foundry/Notify-Chain.git
   ```

## Development Workflow

### 1. Create a Branch

Always start from an up‑to‑date `main`:
```bash
git checkout main
git pull upstream main
git checkout -b <branch-name>
```

Use descriptive branch names following these conventions:
- `feature/` for new features
- `fix/` for bug fixes
- `docs/` for documentation
- `refactor/` for code refactoring
- `test/` for adding or modifying tests
- `chore/` for maintenance tasks

Example:
- `feature/add-slack-notifications`
- `fix/resolve-event-deduplication-bug`
- `docs/update-contributing-guide`

### 2. Make Your Changes

- Write clean, readable code
- Follow existing code style in each directory
- Add comments for complex logic
- Update documentation as needed

### 3. Write and Run Tests

All new features and bug fixes must include tests.

#### Contract Tests (Rust)
```bash
cd contract/contracts/hello-world
cargo test
```

#### Listener Tests (TypeScript)
```bash
cd listener
npm install
npm test
```

#### Dashboard Tests (TypeScript)
```bash
cd dashboard
npm install
npm test
```

### 4. Commit Changes

Write clear, descriptive commit messages following [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation changes
- `test:` test additions or changes
- `refactor:` code refactoring
- `chore:` maintenance tasks

Example:
```bash
git commit -m "feat: add retry queue for failed notifications"
git commit -m "fix: resolve event parsing issue in listener"
git commit -m "docs: update README with setup instructions"
```

### 5. Push and Create PR
```bash
git push -u origin <branch-name>
```

Then create a Pull Request on GitHub!

## Pull Request Guidelines

### PR Title
Use the same format as commit messages:
- `feat: add retry queue for notifications`
- `fix: standardize error messages across contracts`

### PR Description
Include:
1. **Overview**: What changes does this PR introduce?
2. **Related Issue**: Link to GitHub issue(s) this PR addresses
3. **Changes**: What was added/removed/modified
4. **Verification Results**: What tests passed, coverage, etc.
5. **How to Test**: Instructions for testing your changes

### PR Checklist
- [ ] Code follows project style guidelines
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] All tests pass locally
- [ ] Branch is up to date with `main`

## Code Style Guidelines

### Rust (Soroban Contracts)
Follow existing patterns in `contract/contracts/hello-world/`:
- Format with `cargo fmt`
- Add `///` documentation comments for public functions/structs
- Use `#[contracterror]` for custom errors
- Test all functionality

### TypeScript (Listener/Dashboard)
Follow the existing style in `listener/` and `dashboard/`:
- Run `npm run lint` before committing
- Use TypeScript for type safety
- Write unit tests for all new logic
- Follow existing naming conventions

## Review Process

### For Contributors
1. Ensure all tests pass locally
2. Address reviewer feedback promptly
3. Keep PR scope focused on a single issue or feature
4. Be open to suggestions

### For Reviewers
1. Review code thoroughly
2. Test locally if needed
3. Provide constructive feedback
4. Approve when ready

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues and PRs first
- Join discussions on GitHub

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to NotifyChain! 🎉
