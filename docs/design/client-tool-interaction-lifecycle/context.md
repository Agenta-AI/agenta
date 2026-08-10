# What happened, and why we started this project

## What Mahmoud saw (2026-08-10, on the release stack)

He asked for an agent that sends Arabic poetry to Telegram every morning. The agent
asked him a form, then asked to connect Telegram, then asked to approve a schedule.
Each step should show one card. Instead:

1. The "running somewhere else" strip showed in his own tab. His tab WAS the run.
2. When the connect card appeared, the form he had already answered appeared again,
   empty. His answer was lost.
3. After he connected, he had to answer the form a second time.
4. At the schedule step, the old connect card came back. It was dead. No button worked,
   not even "Not now". The strip flashed again. The form showed a third time.
5. In a later run, the connection worked. The agent still asked him to connect again.

His summary: when there is one new thing to show, the UI shows everything instead of
that thing. That summary became the thesis of this project.

## Why the bugs kept coming back

We fixed each symptom where it appeared. Each fix was real. The class survived, because
the state of a card lives in four places, and the four places do not agree:

1. The chat the browser tab holds in memory.
2. The record list on the server.
3. The interaction row in the database.
4. A saved copy of the chat in the browser's local storage.

Different screens read different places, at different moments. Some server actions
change a card's state and tell nobody. And the deepest problem: when the user answers a
card, the system never writes "answered" anywhere durable. See research.md.

## Goal

One clear rule for what a card may show, from one agreed source of truth. And a
guarantee: when the user answers a card, the system records the answer, the screen
shows it, and the agent learns it.

## Not in this project

- New card designs.
- Reusing an existing connection instead of asking again (issue #5911).
- Letting the mobile app answer form and connect cards (it never could; own ticket).
