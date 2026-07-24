# Agent multi-modality

This project lets a person share files with an agent and have two things happen at once:
the model reads the file, and the agent can work on the file with its tools. Today neither
happens. A person can attach an image or a document in the agent chat box, but the file is
thrown away just before it reaches the model, so the model never sees it and the agent never
gets it.

A second goal sits beside the first. Every file a person shares must stay easy to find later,
even after the agent has changed things. If you gave the agent a spreadsheet an hour ago, you
should be able to open exactly that spreadsheet again, unchanged, without hunting through the
agent's scratch files.

This folder holds the research, the design, and the plan for closing that gap. The work is
staged so that the first stages are small and safe and later stages add the harder modalities
(audio and documents).

## Glossary

These terms appear across every file here. Each one names a real thing in our system and says
where it runs.

- **Agent.** A coding assistant that can read and write files and call tools, driven by a
  large language model. In our product it runs inside a sandbox.
- **Model.** The model is the large language model itself (for example Claude or a GPT model). The
  model is what perceives an image or a document when the bytes are delivered to it in the right way.
- **Harness.** The program that drives the model through one agent turn (for example Claude
  Code or Pi). The harness owns the model conversation. We do not own the harness code.
- **Runner.** Our own Node.js service that starts a sandbox, launches the harness inside it,
  and passes each turn's message to the harness. The runner is where the file is dropped
  today. It lives at `services/runner/`.
- **Sandbox.** The isolated Linux environment the agent runs in. The agent's files and shell
  commands all happen inside the sandbox.
- **Session.** One ongoing conversation with an agent. A session has a stable id that the
  front end creates before the first message is sent.
- **Turn.** One request-and-reply within a session. The person sends a message, the agent
  works and answers. That is one turn.
- **cwd (working directory).** The folder the agent runs in inside the sandbox. It survives
  across turns of the same session. The agent can create, change, and delete anything in it.
- **Mount.** Our file storage unit. A mount is a named area in an object store (S3) with its
  own keys and its own access credentials. The `cwd` is backed by a mount. Mounts live in the
  API at `api/oss/src/core/mounts/`.
- **geesefs / FUSE mount.** The technology that makes a storage mount appear as a normal
  folder inside the sandbox. When a mount is "mounted into the sandbox," the agent sees it as
  a directory it can read and write.
- **ACP (Agent Client Protocol).** The message format the runner uses to talk to the harness.
  It is an external standard published by Zed Industries. We cannot change it. It defines the
  content types a turn can carry (text, image, audio, and so on).
- **Content block.** One piece of a message in ACP: a text block, an image block, an audio
  block, or a resource block. A turn is a list of content blocks.
- **Materialize.** The runner materializes a file when it writes a copy of the stored original into
  the agent's working directory so the agent's tools can open it.
- **Records.** Records are the API's durable, per-session log of every event in a conversation. The
  runner writes to it after every event.
- **Drawer / drive / Files drawer.** The front-end panel that lists the files in a session. It
  is a view over one or more mounts. In the code it is the `DriveExplorer`.
- **Attachment resource / attachment_id.** The record the API returns when a file is uploaded. It
  holds a server-issued `attachment_id`, the filename, the media type the server verified, and the
  size. The API owns the storage location behind the id, so a client never sees it. The
  `attachment_id` is the opaque token that travels on the wire, in the saved history, and in the
  traces.
- **Reference (attachment reference).** The `attachment_id` plus a little display metadata, sent in
  a message in place of the file's bytes. It carries no bytes and no raw storage coordinates; it
  points at the attachment resource above, which the runner resolves through the API.
- **Front end / composer.** The front end is the browser app. The composer is its message editor:
  the box where a person types, attaches files, and sends a turn.
- **API.** Our FastAPI backend service. It owns storage, permissions, sessions, and records, and it
  is the only component that talks to the object store with full rights.
- **SDK.** Our Python library that sits between the API and the runner. It parses incoming messages
  into content blocks and writes the wire payload the runner reads.
- **Adapter.** The translation layer inside the harness that converts ACP content blocks into the
  model provider's own API calls. We run two: `claude-agent-acp` (maintained by Zed) for Claude, and
  `pi-acp` (from the Pi project) for Pi.
- **Object store.** The S3-compatible storage service where mount bytes live.
- **Wire.** The serialized request that travels from the front end through the API to the runner for
  one turn.
- **Native modality.** A kind of content (an image, audio, a document) that a model perceives
  directly through its own encoder when the bytes are delivered inside the message content.
  Everything else is a plain file that only tools can open.
- **Capability.** A yes-or-no fact about what a layer supports, advertised or configured, used to
  decide whether a modality can reach the model.
- **Warm session / cold start.** A session is warm when its harness process is still running and can
  continue the conversation. A cold start is when that process is gone and the runner must rebuild
  the conversation before running the new turn.
- **Cold replay.** The runner's reconstruction of the conversation during a cold start, today by
  flattening past messages to text.

## Read in this order

1. **[context.md](context.md)**: What a person experiences today, why the file is lost, and
   what "done" looks like. Start here if you want the plain story with no design.
2. **[research.md](research.md)**: The findings the design rests on: what the mounts API can
   do and who may call it, how different kinds of files are handled by models, how ACP carries
   content and what each harness does with it, how other tools (Zed, opencode) handle
   attachments, and the state of records and capability flags in our code. Every claim links to
   a file and line or to a source.
3. **[design.md](design.md)**: The design itself, written as options and decisions. For each
   major choice it gives the alternatives, what breaks under each, the decision, and why. It
   keeps every interaction diagram, each with the flow explained in words first.
4. **[plan.md](plan.md)**: The staged implementation plan: what changes in each layer, who
   owns each part, how each stage is tested, and how the plan holds up against the review
   lenses (responsibilities, engineering practice, tradeoffs, scale, and fit with the rest of
   the architecture).
5. **[scope.md](scope.md)**: What is in, what is out, and the follow-up work with a sentence
   each on why it waits.
6. **[decisions.md](decisions.md)**: The decision log and the open questions, each with what
   is unknown, why it matters, and how to settle it.
7. **[status.md](status.md)**: Where the project stands and what happens next.
