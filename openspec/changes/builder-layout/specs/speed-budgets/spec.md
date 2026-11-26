## ADDED Requirements

### Requirement: Bundle budget stays within speed:check
The program SHALL keep the first-load size of every `/m` route within the budget of `web/mobile/scripts/speed/budget.json` as `speed:check` checks it. Heavy views (the builder panel, the change card diff, the item pane, every configuration view) SHALL load with `next/dynamic`. No PR SHALL raise a budget without Mahmoud's approval.

#### Scenario: PR that changes web/mobile pages
- **WHEN** a PR of the program changes `web/mobile` pages or code they import
- **THEN** `pnpm --filter @agenta/mobile exec next build` followed by `pnpm --filter @agenta/mobile speed:check` passes, with the route `/agents/[agent_id]` at or under 1,869,151 bytes plus the margin (3 percent or 5 KB, the larger)

#### Scenario: New route
- **WHEN** a PR adds a route
- **THEN** the PR body asks Mahmoud for the budget line, and `speed:check --write` runs only after his approval

#### Scenario: New dependency
- **WHEN** a PR adds a package dependency to `web/mobile` or to an `@agenta/*` package it imports
- **THEN** the PR is refused, unless Mahmoud approved the dependency

#### Scenario: Build and dev compile time
- **WHEN** the program reaches the release milestone
- **THEN** `pnpm --filter @agenta/mobile speed:timing` runs once and its build and cold dev times stay within the 15 percent margin

### Requirement: Session switch time budgets
In a production build of the program branch, a session switch SHALL meet these budgets of the switch timing spec: click to URL at most 50 ms; warm switch (same agent or other agent) click to done at most 160 ms; cold switch (same agent) click to done at most 560 ms. Each case SHALL NOT be slower than the same case on the production stack. The numbers are PROPOSED. Five-run medians are diagnostics until the speed project knows the run-to-run spread.

#### Scenario: Warm switch, same agent
- **WHEN** the timing spec runs warm switches between two sessions of one agent
- **THEN** the median click to done is at most 160 ms (prototype measurement on 19 November 2026: 339 ms, of which 220 ms is the click hold)

#### Scenario: Warm switch, other agent
- **WHEN** the timing spec runs warm switches to a session of another agent
- **THEN** the median click to done is at most 160 ms (prototype measurement: 331 ms)

#### Scenario: Cold switch, same agent
- **WHEN** the timing spec runs cold switches
- **THEN** the median click to done is at most 560 ms (prototype measurement: 747 ms)

#### Scenario: Click to URL
- **WHEN** any switch runs
- **THEN** the URL shows the new session at most 50 ms after the click (measured: about 250 ms)

#### Scenario: Not slower than production
- **WHEN** the same case runs on the program branch and on the production stack
- **THEN** the median on the program branch is at most the median on the production stack

#### Scenario: Spread not known yet
- **WHEN** the run-to-run spread of a case is not yet measured
- **THEN** its median is a diagnostic and does not block a merge; the budget becomes a release gate after task 55.2 reports the spread

#### Scenario: Long session
- **WHEN** the timing spec runs on a session with records of 200 KB or more
- **THEN** the result is recorded as the baseline of a long session, and the speed project sets its budget from it (not measured yet)

### Requirement: Switch timing method
The switch timing spec SHALL click a sidebar session row and record click to URL and click to done in the target conversation only, never in another conversation on the page. It SHALL record long tasks and every API request with its method, project and payload, and SHALL count a duplicate only when all three match. It SHALL run on demand against a production build, never in CI.

#### Scenario: Two conversations on screen
- **WHEN** the builder panel shows its own conversation next to the target session
- **THEN** the spec reads the last turn of the target conversation, not the last turn of the whole page

#### Scenario: Duplicate count
- **WHEN** two requests share the path `POST /sessions/query` but have different payloads
- **THEN** the spec does not count them as duplicates

#### Scenario: Quiet period
- **WHEN** the target turn is painted and long tasks end
- **THEN** click to done is the later of the paint and the end of the last long task, and the 300 ms quiet wait after it is not counted

#### Scenario: Output
- **WHEN** one run of the spec ends
- **THEN** it writes one JSON file with the warm same-agent, warm other-agent and cold cases

### Requirement: Sidebar click does not wait
A click on a session row SHALL start navigation in the same task as the click. The switch timing spec SHALL show no idle main-thread gap between the click and the route change.

#### Scenario: Trace of a click
- **WHEN** a performance trace records a sidebar session click
- **THEN** no timer of 220 ms (or any timer) sits between the click event and `router.push`

### Requirement: Builder panel keeps its conversation on a same-agent switch
When the user switches to another session of the same agent with the builder panel open, the builder conversation's state SHALL survive (composer text, scroll position, an open quick action, a running answer). The switch itself SHALL cause no render of the builder conversation outside the page context chip. Renders from a streaming answer SHALL be allowed. A render test SHALL check this.

#### Scenario: Composer retention
- **WHEN** the user typed text in the panel composer and scrolled the panel chat, then switches session in the same agent
- **THEN** the composer text, the scroll position and a running answer are unchanged

#### Scenario: Navigation causes no builder work
- **WHEN** the render test changes the page session while the builder answer is idle
- **THEN** only the chip renders again, and it shows the new session title

#### Scenario: Streaming during a switch
- **WHEN** the builder answer streams while the user switches session
- **THEN** the test allows the renders of the streaming text and still checks the composer text and the scroll position

#### Scenario: Other agent
- **WHEN** the user switches to a session of another agent
- **THEN** the panel may re-render, because the 2-day rule runs for the new agent

### Requirement: State survives when a conversation changes its page role
A conversation SHALL keep its state (composer text, scroll position, a running answer) when its page role changes, for example from the builder panel (`embedded`) to the builder page (`page`). A remount that restores the state SHALL be allowed. This SHALL be checked by a render test.

#### Scenario: Role change in a test
- **WHEN** a render test changes the page role of a conversation with text in its composer
- **THEN** the composer text and the scroll position are kept

#### Scenario: No key on the role
- **WHEN** a reviewer reads a PR that renders a conversation
- **THEN** the React `key` of the conversation does not include its page role

### Requirement: No code needs the whole history in memory
New code SHALL NOT need every record of a session in memory. It SHALL NOT count all records, search all records, or compare the whole local history with the server, so that a later paged read works. This SHALL be checked by a unit test with a partial history and by the review.

#### Scenario: Partial history test
- **WHEN** a unit test gives a new transcript feature only the last 100 records of a 1,000-record session
- **THEN** the feature works on the window it has and does not ask for the older records

#### Scenario: Review
- **WHEN** a PR of the program reads session records
- **THEN** its PR body says whether it reads a window or the whole log, and the review loop refuses a new whole-log read
