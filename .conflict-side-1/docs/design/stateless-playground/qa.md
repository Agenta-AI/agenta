# QA Plan: Stateless Playground

## Test Scenarios

### 1. Basic Navigation

| ID | Scenario | Expected |
|----|----------|----------|
| NAV-1 | Click Playground in sidebar (project section) | Navigate to `/w/{workspace_id}/p/{project_id}/playground` |
| NAV-2 | Page loads without app context | No errors; shows empty prompt editor |
| NAV-3 | Refresh page | State clears; shows empty prompt editor |

### 2. Prompt Editing

| ID | Scenario | Expected |
|----|----------|----------|
| EDIT-1 | Add system message | Message appears in editor |
| EDIT-2 | Add user message with variable `{question}` | Message appears; variable is highlighted |
| EDIT-3 | Change model to gpt-4o-mini | Model selector updates |
| EDIT-4 | Adjust temperature to 0.5 | Slider/input updates |
| EDIT-5 | Add tool definition | Tool appears in config |

### 3. Test Case Management

| ID | Scenario | Expected |
|----|----------|----------|
| TC-1 | Add row with no variables | Row appears with empty cells |
| TC-2 | Add row after defining variable `{question}` | Row has `question` column |
| TC-3 | Edit cell value | Value persists until page refresh |
| TC-4 | Delete row | Row removed |
| TC-5 | Add multiple rows | All rows visible |

### 4. Execution

| ID | Scenario | Expected |
|----|----------|----------|
| EXEC-1 | Run with valid prompt and testcase | Output appears; latency/tokens/cost shown |
| EXEC-2 | Run with missing variable value | Error message or placeholder used |
| EXEC-3 | Run with invalid model | Error message from LLM provider |
| EXEC-4 | Run with no vault secrets configured | Clear error about missing API key |
| EXEC-5 | Run multiple rows | All rows execute; results shown per row |
| EXEC-6 | Cancel mid-execution | Execution stops; partial results shown |

### 5. Mode Toggle (Phase 4)

| ID | Scenario | Expected |
|----|----------|----------|
| MODE-1 | Switch to chat mode | UI changes to chat interface |
| MODE-2 | Run chat prompt | Chat history flows correctly |

### 6. Edge Cases

| ID | Scenario | Expected |
|----|----------|----------|
| EDGE-1 | Empty prompt (no messages) | Run button disabled or shows error |
| EDGE-2 | Very long prompt | Execution succeeds; no truncation |
| EDGE-3 | Unicode in prompt | Renders and executes correctly |
| EDGE-4 | Multimodal content (image) | Image renders; execution works |
| EDGE-5 | Network offline | Clear error; no crash |
| EDGE-6 | Rate limited by provider | Error message shown |

### 7. Regression: App Playground

| ID | Scenario | Expected |
|----|----------|----------|
| REG-1 | Navigate to app playground | Existing behavior unchanged |
| REG-2 | Variant selection works | Can select and compare variants |
| REG-3 | Draft changes persist in URL hash | URL updates; refresh restores state |
| REG-4 | Save/commit works | Revision saved to backend |
| REG-5 | Run execution works | Results appear as before |

---

## Manual Testing Checklist

Before merge:

- [ ] Stateless page loads without errors
- [ ] Can create and edit prompt
- [ ] Can add and edit testcases
- [ ] Can run prompt and see output
- [ ] Refresh clears state (expected)
- [ ] App playground still works (regression)
- [ ] No console errors in either mode

---

## Automated Tests (Future)

Unit tests:

- Stateless bindings adapter provides correct values
- Draft prompt state updates correctly
- Loadable bridge local mode works

Integration tests:

- Full execution flow: UI to worker to service to response to UI
- Error scenarios (missing secrets, invalid model)

E2E tests (if applicable):

- Navigate to stateless playground
- Create prompt, add row, run, verify output
