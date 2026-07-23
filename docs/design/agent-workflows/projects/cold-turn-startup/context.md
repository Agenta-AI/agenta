# Context

## What the user experiences today

When a user sends the first message of a conversation, the agent takes about two seconds
longer to begin answering than the model itself needs. That delay is fixed setup work the
runner and the Pi adapter do before the first model request goes out. It repeats on every
cold turn. It is present both for local runs and for runs inside a Daytona sandbox, and it is
worse inside a sandbox because one of the probes reaches the public npm registry over the
network from a European sandbox.

Profiling on the live local runner on 2026-07-11 attributed the delay to two independent
causes:

- About 1.6 seconds comes from three version-check probes the Pi adapter runs at session
  start (Fix A).
- About 0.55 to 0.6 seconds comes from the runner mounting the durable working directory
  before it opens the session, even on a turn that never reads or writes a file (Fix B).

The two causes are unrelated in the code. They can ship separately.

## Why this work exists

Neither cost buys the user anything on a normal turn.

The Pi adapter probes exist to print a startup banner and an "upgrade available" notice. The
runner already throws that banner away: `services/runner/src/tracing/otel.ts` strips the
banner lines out of the reply after the fact. So the runner pays 1.6 seconds to produce text
it then deletes.

The durable mount exists so files the agent writes survive to the next turn. A chat-only turn
writes no files, so on those turns the mount is pure setup cost with no payoff. The difficulty
is that the runner cannot know in advance whether a turn will stay chat-only.

## Goals

- Remove the Pi adapter startup probes from the cold-turn path, for both local and Daytona
  runs. Target saving: about 1.6 seconds per cold turn.
- Once the probes are gone, retire or shrink the banner-stripping code in `otel.ts`, since it
  exists only to clean up after those probes.
- Investigate removing the eager durable mount from chat-only cold turns. Target saving: about
  0.55 to 0.6 seconds per cold local chat turn. Ship this only if it can be made safe.

## Non-goals

- No change to what the agent can do, only to how fast a cold turn starts.
- No change to the durable-store contract or the wire protocol.
- No attempt to warm-pool Pi sessions or otherwise avoid cold starts entirely. That is a
  separate, larger effort.
- No change to the Daytona snapshot build in this plan beyond what Fix A strictly needs to
  reach the in-sandbox adapter copy.
