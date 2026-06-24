# Agent Workflow Interfaces

The agent workflow stack spans a Python service, a Node runner, a sandboxed harness, a
browser client, the vault, and the trace pipeline. A change in one of these places often
breaks a contract that lives in another. This folder names those contracts so a reviewer
can tell, before reading the diff, which boundary a change touches and what it can break.

Read it as review context, not as a tutorial. The code is still the source of truth. Each
page points at the files that own the contract and says what to check when it moves.

## How the inventory is organized

The split is by blast radius, because blast radius is what decides how careful a review
has to be.

- **[Public edge](public-edge/)** holds the contracts that browser and workflow clients
  depend on. Break one and you break callers you do not control, so these change most
  conservatively.
- **[Cross-service](cross-service/)** holds contracts that cross a process, container, or
  external service boundary. Each side deploys and fails on its own, so a field can change
  on one side and reach an older version on the other.
- **[In-service](in-service/)** holds contracts that stay inside one process or package.
  They are still contracts. They break adapters, tests, and extension points even when no
  wire field changes.

## How to read each page

Every page follows the same shape so you can scan it fast:

- One short statement of what crosses the boundary and why it matters.
- The concrete contract: the real types, fields, and shapes, not a list of names.
- The files that own it.
- What to check when you change it, including the tests that move with it.

## Source of truth

When a field changes, update the owner file, the tests, and the matching page here in the
same PR. A page that has drifted from the code is worse than no page. It reads as
authoritative while it is wrong.
