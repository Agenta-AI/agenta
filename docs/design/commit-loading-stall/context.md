# Context

## Background
- The playground commit flow uses CommitVariantChangesModal to save variant changes and optionally deploy.
- The modal waits for local state to reflect the new revision before closing.

## Problem Statement
- Users report that committing sometimes takes a very long time or appears stuck despite fast API responses.
- The UI shows a loading spinner until client state updates.

## Goals
- Identify the UI/state conditions that keep the commit modal loading.
- Ensure commits close promptly while still allowing state to settle when needed.
- Preserve deploy-after-commit and revision selection behavior.

## Non-goals
- Backend API performance or schema changes.
- Redesigning the commit UX beyond fixing the loading stall.
- Fixing unrelated testset or evaluator commit flows unless evidence surfaces.
