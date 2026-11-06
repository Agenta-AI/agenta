---
name: test-design
description: Decide what to test and how to write the tests for a frontend change. Use before you write or review unit tests for web/mobile or the @agenta/* packages, when you fix a bug and add a regression test, and before you say a change is tested. Gives the risk list, the rules for each test, and the mutation check.
---

# Test design

Tests exist to catch a change that hurts a user. Do three things in order.

## 1. List the risks first

Before you write a test, write a short risk list. Put it in the PR body under "What the tests cover". Ask what this change can break for a user. Order the answers by cost:

1. Saved data is lost, changed, or sent wrong (commit, rename, delete, discard, import).
2. The wrong scope or permission: another project's data, a hidden view, a role that must not see it.
3. A main flow stops: open, edit, save, run, navigate.
4. The screen shows a wrong value or a wrong state.
5. Looks and copy. These need no unit test.

For each risk in groups 1 to 3, check these cases:

- The normal case.
- Empty, missing, or one item.
- More than one page of data.
- The request fails, answers late, or answers out of order.
- The user acts twice, or acts while a save runs.
- The user leaves the page or discards the change.

Write one test for each risk and case that matters. Skip a case only if you can say why it cannot happen.

## 2. Write each test through the screen

- Name the test as a user behavior, in a plain sentence.
- Test through the screen, the hook, or the package atom. Do not test private helpers or the order of internal calls.
- Use the real `@agenta/*` atoms, molecules, and controllers in a `createStore()` store.
- Mock only what lives outside the code: HTTP, time, randomness, and the router.
- If a test needs more than about 5 `vi.mock` calls, the level is wrong. Move down to the package state, or up to a screen with real children.
- Never assert on a mock. If the assertion still passes after you remove the mock, or fails because of it, delete the assertion.
- Find elements as a user does: by role, label, or visible text. Do not use CSS classes or test ids. In `web/mobile`, use `@testing-library/react` (`screen`, `render`).
- Write expected values as literals. Do not compute them with the code under test.
- For code that saves data, assert the exact request body that reaches the server.
- A pure function with a rule over many inputs may use a table of cases.
- Do not write tests for constants, copy, styles, type shapes, or framework behavior. Do not write a test only to raise coverage.

## 3. Check your tests before you finish

Run the mutation check. Break the code in each realistic way below, one at a time, and confirm that at least one test fails:

- A wrong constant or argument.
- A condition turned around, or a wrong branch.
- A missing state change or a missing request.
- An empty or default return.
- A missing check for empty, null, or not allowed.

If no test fails, add a test. Or write in the PR body why the behavior is not covered.

For a bug fix, write the test that fails before the fix. Then ask which other cases from the list in block 1 have the same weakness. Test those cases too, in the same PR.
