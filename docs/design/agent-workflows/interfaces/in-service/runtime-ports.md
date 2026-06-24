# Runtime Ports

The runtime ports are the abstract seams that let the service swap backends and harnesses
without touching the orchestration. They are Python ABCs in one file. The service composes
them; the adapters implement them. Read this page to understand the lifecycle a run moves
through, from backend to sandbox to session to harness.

## The ports

All in `interfaces.py`. Each has a narrow job:

- **`Backend`**: the engine abstraction. Declares `supported_harnesses`, and creates
  sandboxes and sessions.

  ```python
  async def create_sandbox(self) -> Sandbox: ...
  async def create_session(self, sandbox, config, *, harness,
                           secrets=None, trace=None, session_id=None) -> Session: ...
  ```

- **`Sandbox`**: provisioning and teardown. `add_files(files)` and `destroy()`.
- **`Session`**: one conversation. The core port:

  ```python
  @property
  def id(self) -> Optional[str]: ...
  async def prompt(self, messages, *, on_event=None) -> AgentResult: ...
  def stream(self, messages) -> AgentRun: ...
  ```

- **`Environment`**: owns sandbox policy over a backend. `sandbox_per_session` decides whether
  each session gets a fresh sandbox. Its `create_session(...)` is what the harness calls.
- **`Harness`**: maps a neutral `SessionConfig` to a harness-specific config and runs turns.
  The one abstract method is `_to_harness_config(config) -> HarnessAgentConfig`; the base
  supplies `prompt`, `stream`, and `create_session`.
- **`SessionStore`**: durable message history. `load(session_id)` and
  `save_turn(session_id, *, messages, result)`. Only `NoopSessionStore` is wired today, so
  history is not persisted yet (see [Agent load session](../public-edge/agent-load-session.md)).

## Owned by

- `sdks/python/agenta/sdk/agents/interfaces.py`

## Watch for when changing

- **Backend lifecycle.** `setup`/`shutdown` and sandbox creation define when resources spin
  up and tear down.
- **Cold versus warm sessions.** `sandbox_per_session` and the cold-runtime assumption
  (full history every turn) hang off these ports.
- **Session teardown.** `destroy()` defaults to a no-op; an implementation that holds
  resources has to override it.
- **Durable history.** Wiring a real `SessionStore` changes the `/load-session` contract.
- **Harness responsibilities.** `_to_harness_config` is the single point a new harness has to
  implement.
