# Agenta Local POC

This workspace plans a proof of concept for a single-user Agenta application that
runs on one computer without Docker. The current Agenta Cloud product remains the
multi-user product. The POC proves that a user can create an agent, configure a model,
run a conversation, and reopen it later with all local state still on the machine.

The plan separates the hard runtime proof from desktop packaging. The POC ends with a
localhost browser application and managed runtime bundle. A desktop shell is a separate
productization project after the POC decision.

## Reading order

| File              | Question it answers                                                          |
| ----------------- | ---------------------------------------------------------------------------- |
| `context.md`      | What user problem does the POC test, and what is out of scope?               |
| `research.md`     | What can we reuse, and why can we not package the current stack directly?    |
| `architecture.md` | Which processes run locally, and how do local and cloud experiences coexist? |
| `contracts.md`    | What local HTTP contracts and SQLite records does the POC need?              |
| `plan.md`         | In what order should we build and validate the POC?                          |
| `qa.md`           | What evidence makes the POC successful?                                      |
| `status.md`       | Which decisions are settled, blocked, or deferred?                           |

## Terms

- **Local service:** the small Python HTTP process that owns local agent definitions,
  revisions, conversations, credentials, and SQLite persistence.
- **Runner:** the existing Node service that executes an agent through a harness and
  streams runtime events back to the caller.
- **Harness:** the program-specific adapter that drives an agent implementation. The POC
  supports Pi only.
- **Local workspace:** the application-data directory that holds the SQLite database,
  logs, and any local working files.
- **Cloud workspace:** an existing Agenta Cloud organization, workspace, and project with
  multi-user access, RBAC, evaluations, and hosted persistence.
- **Renderer:** the React user interface shown in a browser or desktop window.
- **Cold turn:** one runner request that contains the full conversation and does not rely
  on the platform session APIs between turns.
- **Text-only mode:** a run with Pi's built-in shell and filesystem tools present but
  denied by the runner permission policy.

## One-sentence recommendation

Build a local-only service around the existing Python agent SDK and Node runner, persist
the small product surface through local core interfaces and SQLite adapters under
`services/local`, serve a narrow React UI on loopback, and add desktop packaging only
after that path passes end-to-end tests.
