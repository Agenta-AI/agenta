# Runner replicas

This folder holds the design for running the agent runner as two or more Kubernetes pods. It
answers GitHub issue [Agenta-AI/agenta#7322](https://github.com/Agenta-AI/agenta/issues/7322),
"Runner cannot run two replicas".

The recommended design, the minimal design, makes two pods safe and keeps conversations warm:
each pod keeps the sandboxes it creates, every control path reaches the right pod, and each
follow-up goes to the pod that holds its conversation. A cold turn happens only when a pod dies,
restarts, or is replaced by a deploy. Design B, which lets any pod adopt any sandbox, is fully
designed but optional and not scheduled. Both share six common changes.

## Reading order

| File | Read it to learn |
| --- | --- |
| [context.md](context.md) | Why the work exists, what a user sees today with one pod, what breaks with two pods, the goals and non-goals, and the constraints from earlier work. |
| [plan.md](plan.md) | How the runner holds a session today, the six common changes, the minimal design, the interface changes, what a user sees after it ships, the alternatives, the optional design B, the verification plan, the implementation order, and the four decisions. |
| [status.md](status.md) | Where the work stands, the open decisions as a checklist, and the history of the design. |
| [research.md](research.md) | The verified map of the current code, with `path:line` citations. Other files cite it as "research.md section N". |
| [github-context.md](github-context.md) | The related issues and pull requests, and what that history means for the design. |

Read context.md first, then plan.md. Use research.md when you need the exact code location.

## Glossary

Each term has one meaning in every file of this folder. Later files use these terms without
defining them again.

### Components

- **api**: the FastAPI backend in `api/`, which owns Postgres, Redis, and every durable record
  of a session.
- **services layer**: the Python service in `services/` that receives a workflow invoke and
  forwards an agent turn to the runner.
- **runner**: the Node.js service in `services/runner` that drives agent harnesses and reaches
  stored state only through the api over HTTP.
- **pod**: one running copy of a container in Kubernetes; one runner pod runs one runner
  process.
- **replica**: one of several identical pods that a Kubernetes Deployment keeps running.
- **Service**: the Kubernetes object that gives all runner pods one address
  (`http://<release>-runner:8765`) and sends each request to any ready pod.
- **Service URL**: the one runner address that the api and the services layer use today,
  read from `AGENTA_RUNNER_INTERNAL_URL`.
- **pod address**: the URL at which the api reaches one specific runner pod, for example
  `http://10.8.2.17:8765`, built from the pod's own IP.
- **harness**: the agent program (Pi, Claude Code, or Codex) that runs the model loop and calls
  tools.
- **ACP**: Agent Client Protocol, the JSON-RPC protocol that the runner uses to talk to a
  harness.
- **Daytona**: the cloud provider of sandboxes, which the runner calls to create, stop, start,
  and delete them.
- **sandbox**: a Daytona virtual machine in which a harness or its tools run.
- **sandbox-agent daemon**: the program inside a Daytona sandbox that starts the harness and
  relays ACP between the harness and the runner over HTTP.
- **label**: a key and value pair stored on a Daytona sandbox, which Daytona can filter on when
  it lists sandboxes.
- **autostop and autodelete**: two Daytona timers: one stops a sandbox after 15 minutes with no
  SDK call, the other deletes it 30 minutes after the stop.
- **label inventory**: the list of a session's sandboxes that the runner gets by asking Daytona
  for every sandbox labelled with the session's project and session ids.
- **preview traffic**: requests that reach a sandbox through Daytona's preview proxy, such as
  the runner's ACP stream; Daytona's SDK documentation says they do not reset autostop.

### Sandbox providers

- **Daytona path**: the `daytona` sandbox provider, where the harness runs inside the sandbox
  and the runner holds only a client connection to the daemon.
- **in-process path**: the `inprocess` sandbox provider, where the Pi harness runs inside the
  runner process and only shell and file tools run in a sandbox.
- **command sandbox**: the Daytona sandbox that the in-process path creates on the first tool
  call of a conversation.
- **local provider**: the `local` sandbox provider, where the harness runs on the runner host's
  own disk; this design keeps it at one runner.

### Daytona Secrets

- **Daytona Secret**: a value stored in Daytona and mounted into a sandbox, so that a credential
  never appears in the sandbox's plain environment.
- **Secret allocation**: the facts that tie one sandbox to its Daytona Secrets (their names,
  placeholders, and environment variables) plus the create fingerprint.
- **slot manifest**: in design B, the fixed list written with a sandbox at create of its Secret
  slots, each with its Secret name, allowed hosts, and placeholder.
- **create fingerprint**: a SHA-256 hash of the image and the create request, which tells
  whether an existing sandbox still matches what a new request would create.
- **the Secrets wrapper**: the runner layer that creates a sandbox's Daytona Secrets and keeps
  the Secret allocation in that process's memory only.

### Turns and records

- **turn**: one execution of one user message, from the prompt to the final reply, identified
  by a `turn_id`; the runner mints it for a browser message, the api for the messages it sends.
- **session_turns row**: one Postgres row per turn, which records `turn_index`, `turn_id`,
  `sandbox_id`, and `agent_session_id`.
- **durable session log**: the records that survive any pod: the Postgres session tables, the
  record log, and the transcript files in the object store.
- **record log**: the stored sequence of events of a session, from which any pod can rebuild
  the earlier turns of a conversation.
- **alive and running keys**: two Redis keys, held for the turn in progress, that let at most
  one turn run per session.
- **turn binding**: a write-once Redis key, added by this design, that names the pod that runs
  a turn and that pod's address.
- **holder pod**: the pod named in the binding of a session's last turn, which holds that
  conversation's warm entry and its sandbox.
- **fallback to the Service URL**: the one retry the services layer makes at the Service URL when
  a post to the holder pod's address fails before the first byte of the answer.

### The per-pod cache

- **keepalive**: the runner keeps a session's environment open between turns, so that the next
  message continues the same harness process.
- **SessionPool**: the in-memory map in each pod that holds the kept-alive environments, keyed
  by `<projectId>:<sessionId>`.
- **park**: to put an environment into the SessionPool after a turn, in the state `idle` or
  `awaiting_approval`, with a timer.
- **park-to-stopped**: when a parked entry's timer fires, the pod removes the entry and stops,
  but does not delete, its Daytona sandbox.
- **warm hit**: the next turn finds its environment in this pod's SessionPool and reuses it with
  no setup.
- **cold path**: the setup a pod runs when it has no pool entry: find the sandbox, reconnect or
  create, and reopen the harness session.
- **reconnect steps**: the cold-path steps that reconnect to the latest row's sandbox by id, and
  create a new sandbox only if that fails.
- **session/load**: the ACP call that asks a harness to reopen a past session from its own
  transcript, by the harness's native `agent_session_id`.

### Control

- **heartbeat** (or **beat**): the request a runner sends to the api every 30 seconds while a
  turn runs; the first beat admits the turn.
- **admission**: the api's answer to a turn's first beat, which decides whether that turn may
  run.
- **orphan sweep**: the api background job that settles a turn as `lost` when its last
  heartbeat is older than 90 seconds.
- **Stop**: the user's request to end the running turn and keep the session, stored as a
  `cancel` row in `session_commands`.
- **Kill**: the request to end a session for good and delete its sandboxes.
- **parked approval**: a turn that paused on a tool-approval question, whose open prompt lives
  in one pod's memory in the `awaiting_approval` state.
- **owner key**: the Redis key `owner:<project>:session:<id>`, with a 120-second lifetime, that
  names the runner replica serving a session; this design deletes it.
- **replica id**: the string that a runner pod sends in each heartbeat; this design sets it to
  the pod name.
- **drain**: the first step of a pod's shutdown, in which the pod refuses new turns and lets
  its running turns finish.
- **spike**: a short experiment that answers one question before any code is written.
