# QA: the tests that catch this class of bug forever

This bug class reached production. A human found it, weeks after it started to matter.
This file explains why every test layer missed it, then lists the standing checks that
ship with the fix.

## Why nothing caught it

The bugs live BETWEEN the parts, not inside them. Every part had green unit tests.
Nothing tested the seams: park, answer, resume, reload, adopt. In detail:

1. No test ever checked what the interaction row says after a user answers a card.
2. No test ever crossed a reload, and no test ran two cards in one conversation.
3. In CI, the chat tests fake the agent run. Real park-and-resume cycles almost never
   run.
4. The four state stores (tab memory, record list, rows, local storage) had no test
   that forces them to agree.
5. In production, an answered card recorded as abandoned looks exactly like a user who
   walked away. No metric could see the difference.

## The six standing checks

### 1. The settlement table as a permanent test

For every card kind and every outcome (complete, decline, walk away): call the real
API on a deployed stack and assert the row's final state and saved outcome match the
contract. This single test forbids "success recorded as abandonment" forever.

### 2. Replay tests for every rule line

Saved example histories for every card kind and outcome, including old rows from
before the fix. Assert: the rebuilt chat shows the right card state; both replay code
copies produce the same result; the result is the same with a warm or cold cache.

### 3. The geometry test

One chat fixture with a waiting card that is NOT in the last message. Assert three
things at once: the tab reports "awaiting", the message queue holds, and the card is
clickable. Today three code paths disagree on this; this test makes any future
disagreement a red build.

### 4. The adoption safety test

Adopting the server's chat copy must never throw away an unsent answer, and must never
turn a finished card back into a live one. Tested over hostile orderings: refresh
during answer, adoption during park, reload mid-answer.

### 5. The scripted user journeys as the deploy smoke test

Scripted scenarios, cheap model, run by the release gate and after every deploy. The
first is the exact journey that broke in production. The others are the ways users
really behave, which no test ever imitated. Scripted, these would have caught every
symptom on day one.

1. **The compound journey.** Create an agent; answer its form; RELOAD; assert the form
   shows as answered and the row says so; decline a connect card; assert the decline
   reached the server and the run resumed; approve a schedule; RELOAD; assert every
   card shows once, in its right state, and the "running somewhere else" strip never
   appeared.
2. **Form then connect, back to back.** The agent asks a form, then asks to connect.
   Assert the answered form never comes back empty, and only the connect card is live.
3. **Two connect requests in one conversation.** The agent asks to connect two
   services. Assert each card settles on its own; answering one never touches the
   other; neither comes back after both settle.
4. **Close the tab, then open it again.** Park on a card, close the tab, open the
   session fresh. Assert the card is there, live, and clickable; answer it; assert the
   run resumes. Repeat with a card that was already answered before the tab closed: it
   must show as answered, not live.
5. **Connect for real, remove, connect again.** Using a real Telegram bot token (read
   from the `TELEGRAM_BOT_TOKEN` environment variable, never committed), complete a
   real connection. Assert the row says `responded` with the outcome saved. Remove the
   connection. Ask again. Assert a fresh live card appears and completes. This proves
   the full loop against the real provider, not a mock. Entering the token on the
   provider's hosted page is a browser step, so the `matrix_i2` cell stops short of it
   and this half stays manual.
6. **Decline, then retry.** Decline a connect card. Assert the decline is recorded on
   the row. Click retry: the SAME card re-opens the connection flow in place; no
   second card appears and no second row is created. Assert the recorded decline
   stays on the row until a new outcome replaces it. (Live QA on 2026-08-10 showed
   this is how the product behaves; an earlier version of this line asked for a new
   card, which the product never does.)

### 6. Production alarms

- A scheduled query that alerts when form/connect rows end `cancelled` without a saved
  answer. After the fix, answered rows end `responded` with the answer saved; a rise
  in unresolved cancellations means the class is back, or users are abandoning cards.
  Both matter.
- A browser warning event whenever a card renders clickable while the row says it is
  finished. Support and QA see it immediately.

## Where these checks live in the release process

Checks 1 to 4 become code tests that run in CI. Checks 5 and 6 become release gate
cells: scripts in the agent-release-gate skill's resources, named `matrix_i1` (the
settlement table against the live API) and `matrix_i2` (the scripted journeys above).
The release-conductor skill's Stage 4 lists them as mandatory, next to the existing
lifecycle cells. The conductor runs them on every release and after every deploy to a
stage. A skip counts as a failure to explain, not a pass.

## Out of scope here

Whether the AGENT asks the right things at the right time stays in the benchmark.
These checks pin the machinery, not the model. Mobile gets its checks when mobile
answering gets built.
