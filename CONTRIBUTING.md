---
title: "Contributing to Agenta"
description: "Guidelines for contributing to the Agenta project"
---

Thanks for your interest in contributing to Agenta! We appreciate your effort and aim to make your contribution experience as straightforward as possible.

## Getting Started

1. **Local Installation:** First, set up the project on your local machine. Follow the steps in our [Local Installation Guide](https://docs.agenta.ai/installation/local-installation/local-installation).

2. **Understand the Project:** Familiarize yourself with our architecture and concepts by reading our [Conceptual Guide](https://docs.agenta.ai/conceptual/concepts) and [Architecture Guide](https://docs.agenta.ai/conceptual/architecture).

3. **Begin Development:** Once you've installed the project and understand its architecture, you're ready to contribute. See the [Development Mode Tutorial](https://docs.agenta.ai/contributing/development-mode) for instructions on running the code in development mode.

## Code Formatting and Linting

To maintain code quality, we adhere to certain formatting and linting rules:

- **Backend & CLI Formatting with Black:** Use `black` for formatting code in the following directories:
    - `agenta-backend/**`
    - `agenta-cli/**`
    - `examples/**`

  Install `black` with `pip install black`, navigate to the target directory, and run `black .`.

- **Frontend Formatting with Prettier:** We use `prettier` for frontend formatting. Run `npm run format-fix` in the `agenta-web` directory. If you haven't yet installed `prettier`, do so with `npm install prettier`.

## Contribution Steps

1. **Pick an Issue:** Start by selecting an issue from our issue tracker. Choose one that matches your skill set and begin coding. For more on this, read our [Creating an Issue Guide](file-issue).

2. **Fork & Pull Request:** Fork our repository, create a new branch, add your changes, and submit a pull request. Ensure your code aligns with our standards and includes appropriate unit tests.

3. **Contribute a Larger Feature:** If you're interested in developing a more extensive feature, let's discuss! Contact us directly on Slack or schedule a meeting through this [Calendly link](https://usemotion.com/meet/mahmoud-mabrouk-r0qp/collaborate?d=30).

## Contribution Rules

We had many zombie issues and PRs (assigned but inactive) in the past. We want to avoid this in the future, so we've set up the following rules:
- An issue may only be assigned to one person for up to one week (three days for very simple issues). If the issue remains unsolved after a week, it will be unassigned and made available to others.
- Any pull request (PR) left inactive by the author for over a week will be closed. The author can reopen it if they wish to continue.

We look forward to seeing your contributions to Agenta!