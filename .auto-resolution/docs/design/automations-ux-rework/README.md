# Automations UX Rework

**Branch:** `fix/shady-webhooks`
**Status:** Planning

## Problem

The current automations flow requires users to create a webhook, then separately test it from the table before it becomes active. Users don't discover this requirement, leading to confusion when their automations silently do nothing.

## Goal

Make automations work like GitHub/Stripe webhooks: create = active. Testing is diagnostic, not a gate.

## Documents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, motivation, problem statement, goals/non-goals |
| [plan.md](./plan.md) | Detailed execution plan for Checkpoints 1 and 2 |
| [research.md](./research.md) | Codebase analysis, architecture notes, caveats |
| [status.md](./status.md) | Living progress tracker |
