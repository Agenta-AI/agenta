# TODOS

## Onboarding (deferred from plan-eng-review 2026-06-15, branch claude/clever-khayyam-39459b)

### Full onboarding extraction (React layer) for EE reuse
- **What:** Move the onboarding React layer (provider, widget shell, hooks, tours) into
  `@agenta/onboarding`, using a generic-shell + behavior-callback split (data reads up from
  packages; navigation/drawer/routing injected from the app as callbacks).
- **Why:** Lets EE render the onboarding widget/tours from the package; enables
  tours-co-located-with-features.
- **Pros:** EE reuse; cohesive onboarding home.
- **Cons:** Pulls `@agentaai/nextstepjs` + `antd` into the package graph; large diff; no
  current EE consumer. `OnboardingWidget.tsx` is app-glue (deployments drawer, observability
  trace queries, playground nav, useSession) and must be split first.
- **Context:** The 2026-06-15 eng-review deliberately did NOT do this — the only proven pain
  (5 app adapters firing onboarding events from package-adjacent components) is solved by the
  state-only extraction. This is justified only by a concrete EE widget-reuse need.
- **Depends on:** the `@agenta/onboarding` state extraction landing first.

### Entity-driven widget completion
- **STARTED (commit 702b8b620d):** the app-registered selector machinery now exists in
  `@agenta/onboarding/state` — `setCompletionSelectors({eventId: Atom<{loading,complete}>})`,
  `onboardingWidgetCompletionAtom` unions derived selectors with imperative events (derived
  never un-completes), `onboardingWidgetCompletionLoadingAtom` for the no-flash requirement.
  Covered by 6 unit tests + a real integration test (`testset_created` ⇐ `testsetsListAtom`,
  reusing the entities harness; env-gated). `@agenta/entities` is a test-only devDep; `/state`
  stays entities-free so playground-ui's bundle is unaffected.
- **Remaining:** wire the OSS app (and EE) to actually call `setCompletionSelectors` in
  production with the real selectors; add the other 5 derived selectors (`prompt_created`,
  `evaluation_ran`, `evaluator_created`, `variant_deployed`, `trace_annotated`); have the widget
  consume `onboardingWidgetCompletionLoadingAtom`; EE `setUserAtoms`; decide migration semantics
  for already-onboarded users. The ~6 events with no backing entity stay imperative.
- **What (original):** Derive widget completion from `@agenta/entities` state instead of
  imperative `recordWidgetEvent`. Hybrid resolver, union-with-stored (never un-complete),
  `{loading,complete}` selector contract, behind a flag.
- **Why:** Completion becomes truth-based, not "did we remember to fire the event."
- **Pros:** Fewer scattered imperative event calls; accurate completion.
- **Cons:** Makes onboarding depend on `@agenta/entities`; requires EE to call `setUserAtoms`
  (it does not today — `currentUserAtom` returns null in EE otherwise); loading-state handling
  so a returning onboarded user never flashes 0%; behavioral change needing QA.
- **Context:** This was Approach C from the office-hours design. The eng-review found the
  proven adapter pain is event-firing only, so this was deferred behind the state extraction.
  Completion truth-table (12 items, 6 derived / 6 imperative) is in the design doc.
- **Depends on:** state extraction + a decision that onboarding should depend on entities;
  EE `setUserAtoms` wiring.
