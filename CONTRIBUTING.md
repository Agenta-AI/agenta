---
title: "Contributing to Agenta"
description: "Guidelines for contributing to the Agenta project"
---

Thanks for your interest in contributing to Agenta! We appreciate your effort and aim to make your contribution experience as straightforward as possible.

## Getting Started

1. **Local Installation:** First, set up the project on your local machine. Follow the steps in our [Local Installation Guide](https://docs.agenta.ai/docs/self-host/quick-start).

2. **Understand the Project:** Familiarize yourself with our architecture and concepts by reading our [Core Concepts Guide](https://docs.agenta.ai/docs/concepts/concepts) and [System Architecture Guide](https://docs.agenta.ai/docs/self-host/infrastructure/architecture).

3. **Begin Development:** Once you’ve installed the project and understand its architecture, you’re ready to contribute. See the [Development Mode Tutorial](https://docs.agenta.ai/docs/misc/contributing/development-mode) for instructions on running the code in development mode.

## Code Formatting and Linting

To maintain code quality, we adhere to the following formatting and linting rules:

- **Backend & SDK formatting and linting:** Run `ruff format` followed by `ruff check --fix` when working in `api/` or `sdk/`.

- **Frontend formatting and linting:** Run `pnpm lint-fix` from the `web/` directory. Ensure dependencies are installed via `pnpm install` beforehand.

## Contribution Steps

1. **Pick an Issue:** Start by selecting an issue from our issue tracker. Choose one that matches your skill set and begin coding. For more on this, read our [Creating an Issue Guide](https://docs.agenta.ai/docs/misc/contributing/file-issue).

2. **Fork & Pull Request:** Fork our repository, create a new branch, add your changes, and submit a pull request. Ensure your code aligns with our standards. For pull requests that include frontend changes, please include a short video demo of the feature.

3. **Contribute a Larger Feature:** If you're interested in developing a more extensive feature, let's discuss! Contact us directly on Slack or schedule a meeting through this [Calendly link](https://usemotion.com/meet/mahmoud-mabrouk-r0qp/collaborate?d=30).

## Contribution Rules

We had many zombie issues and PRs (assigned but inactive) in the past. We want to avoid this in the future, so we've set up the following rules:
- An issue may only be assigned to one person for up to one week (three days for very simple issues). If the issue remains unsolved after a week, it will be unassigned and made available to others.
- Any pull request (PR) left inactive by the author for over a week will be closed. The author can reopen it if they wish to continue.

We look forward to seeing your contributions to Agenta!

## Tests

Automated tests are currently unstable in our CI. You do not need to run the test suites locally before opening a pull request, but please exercise extra care when validating your changes.

## Contributor License Agreement
If you want to contribute, we need you to sign a Contributor License Agreement. We need this to avoid potential intellectual property problems in the future. You can sign the agreement by clicking a button. Here is how it works:

After you open a PR, a bot will automatically comment asking you to sign the agreement. Click on the link in the comment, login with your Github account, and sign the agreement.