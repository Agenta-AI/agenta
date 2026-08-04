---
title: "Contributing to Agenta"
description: "Guidelines for contributing to the Agenta project"
---

Thanks for your interest in contributing to Agenta!

The contributor docs are the main source of truth for how to get started, run the project locally, test your changes, and open a pull request.

## Quick Links

- [Contributor overview](https://agenta.ai/docs/contributing/overview)
- [Creating your first PR](https://agenta.ai/docs/contributing/first-pr)
- [Development mode](https://agenta.ai/docs/contributing/guides/development-mode)
- [Testing](https://agenta.ai/docs/contributing/guides/testing)
- [Formatting and linting](https://agenta.ai/docs/contributing/guides/formatting-and-linting)
- [Slack community](https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw)

## Quickstart & Local Development

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/agenta-ai/agenta.git
   cd agenta
   ```

2. **Install Dependencies**:
   ```bash
   pnpm install
   ```

3. **Start Development Server**:
   ```bash
   pnpm dev
   ```

4. **Lint & Test**:
   ```bash
   pnpm lint
   pnpm test
   ```

## Branching & Commit Conventions

- **Branch Naming**: Use clear prefixes for branch names:
  - `feat/feature-name` for new features
  - `fix/issue-description` for bug fixes
  - `docs/topic-name` for documentation updates
- **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/) standards (e.g., `feat: add user evaluation workflow`, `fix: resolve API timeout issue`).

## Pull Requests

Before you request review, make sure your pull request:

- Explains what changed and why.
- Includes a short demo (video or screenshot) for UI changes.
- Lists what you tested locally.
- Notes what still needs QA.
- Passes all formatting, linting, and test checks locally (`pnpm lint`, `pnpm test`).

## Contribution Rules

We had many inactive issues and pull requests in the past. To keep work moving:

- **Issue Assignments**: An issue may only be assigned to one person for up to **one week** (three days for very simple issues). If the issue remains unsolved after a week, it will be unassigned and made available to others.
- **Pull Request Activity**: Any pull request left inactive by the author for over **one week** may be closed. The author can reopen it later and continue the work.

## Contributor License Agreement (CLA)

If you want to contribute, you need to sign the Contributor License Agreement. This helps us avoid intellectual property problems in the future.

After you open a pull request, a bot will comment with a link. Sign the agreement there with your GitHub account.

## Security Vulnerabilities

If you discover a security vulnerability within Agenta, please do **not** open a public issue. Instead, report it privately via GitHub Security Advisories or contact the maintainers directly on Slack.
