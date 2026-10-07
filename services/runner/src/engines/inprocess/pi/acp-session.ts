/**
 * One in-process Pi session behind the ACP session surface the runner's turn code consumes.
 *
 * The translation from Pi to ACP is pi-acp's own `PiAcpSession`, the same class the `local`
 * provider runs in a subprocess (exported by the runner's pi-acp patch). This file only adapts:
 * - Pi's in-memory session to the RPC process interface pi-acp drives (`prompt`, `abort`, the
 *   event stream in RPC shape, and extension dialogs as `extension_ui_request` events);
 * - pi-acp's client connection to the runner's session events and permission requests, in the
 *   shape sandbox-agent hands them to the runner.
 * Two options of that class are used: edit diffs come from the edit tool itself (no file access
 * while mapping events), and a failed prompt is reported with its message.
 */
import { randomUUID } from "node:crypto";
import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  PiAcpSession,
  promptToPiMessage,
  replayPiMessages,
  type DialogToolCall,
  type ExtensionUiResponse,
  type PermissionOption,
  type PermissionOutcome,
  type PiProcess,
} from "pi-acp/session";
import type { SessionEvent, SessionPermissionRequest, SessionRecord } from "sandbox-agent";
import { SESSION_TURN_IN_USE_CODE, SESSION_TURN_IN_USE_MESSAGE } from "../../../sessions/admission.ts";
import { withPublicCode } from "../../sandbox_agent/errors.ts";
import type { EditDiffs } from "../tools/edit-diffs.ts";
import { ExtensionUiChannel } from "./extension-ui-channel.ts";
import { toRpcEvent } from "./rpc-event.ts";
import { TurnWatchdog, type TurnWatchdogLimits } from "./turn-watchdog.ts";

type Listener<T> = (value: T) => void;

/** How long a new prompt waits for a stopped one to unwind before it is queued behind it. */
const STOPPED_TURN_UNWIND_MS = 10_000;
const DISPOSE_UNWIND_MS = 10_000;
/** The one ACP connection an in-process session has. */
const CONNECTION_ID = "inprocess";
/** The session-file entry that marks a failed turn's rollback; Pi never sends it to the model. */
export const FAILED_TURN_ROLLBACK_ENTRY = "agenta.failed_turn_rolled_back";

/**
 * The run asked for a model this runtime does not know: a configuration the user fixes, so it
 * has its own class and a sentence that says what to do (a retry fails the same way). It keeps
 * the ACP `RequestError.internalError` shape the runner's error classifiers read.
 */
export function modelUnavailableError(wanted: string): Error {
  return withPublicCode(
    Object.assign(new Error(`The model '${wanted}' is not available to this agent. Pick another model in the agent's settings.`), {
      name: "RequestError",
      code: -32603,
    }),
    "model_unavailable",
  );
}

interface PendingPermission {
  resolve: (outcome: PermissionOutcome) => void;
  options: PermissionOption[];
}

export interface AcpSessionParts {
  localId: string;
  eventIndexStart: number;
  cwd: string;
  session: AgentSession;
  runtime: ModelRuntime;
  ui: ExtensionUiChannel;
  editDiffs: EditDiffs;
  watchdog: TurnWatchdogLimits;
  /** Called once the session is disposed (removes its private agent dir). */
  cleanup: () => Promise<void>;
  /** Called after every turn with Pi's conversation file, whose size stands for the transcript (memory accounting). */
  onTurnEnd: (transcriptFile: string | undefined) => void;
  /** Put Pi's conversation file on the drive; called after every turn and every rollback. */
  saveTranscript: () => Promise<void>;
  /** How long the end of a turn waits for that save. */
  transcriptSaveTimeoutMs: number;
  log: (message: string) => void;
}

export class InProcessAcpSession {
  readonly id: string;
  readonly agent = "pi";
  readonly createdAt = Date.now();
  private readonly session: AgentSession;
  private readonly runtime: ModelRuntime;
  private readonly ui: ExtensionUiChannel;
  private readonly acp: PiAcpSession;
  private readonly watchdog: TurnWatchdog;
  private readonly eventListeners = new Set<Listener<SessionEvent>>();
  private readonly permissionListeners = new Set<Listener<SessionPermissionRequest>>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private eventIndex: number;
  private currentTurn: Promise<unknown> = Promise.resolve();
  /** False while the drive's conversation file may lack a turn this session completed. */
  private historySaved = true;
  private stopped = false;
  /** Where the transcript stood before the latest prompt: what a failed turn rolls back to. */
  private turnStart: { leafId: string | null } | undefined;
  private silence: ((err: Error) => void) | undefined;
  private readonly unsubscribe: () => void;

  constructor(private readonly parts: AcpSessionParts) {
    this.id = parts.localId;
    this.eventIndex = parts.eventIndexStart;
    this.session = parts.session;
    this.runtime = parts.runtime;
    this.ui = parts.ui;
    this.watchdog = new TurnWatchdog(parts.watchdog, (err) => {
      parts.log(`[inprocess] ${err.message}`);
      this.stopped = true;
      this.silence?.(err);
      void this.session.abort().catch(() => {});
    });
    const handlers = new Set<(event: Record<string, unknown>) => void>();
    const offSession = this.session.subscribe((event) => {
      this.watchdog.observe(event);
      const rpc = toRpcEvent(event);
      for (const handler of handlers) handler(rpc);
    });
    const offUi = this.ui.onRequest((request) => {
      for (const handler of handlers) handler(request);
    });
    this.unsubscribe = () => {
      offSession();
      offUi();
    };
    const proc: PiProcess = {
      onEvent: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      prompt: async (message, images) => {
        await this.session.prompt(message, images?.length ? { images } : undefined);
      },
      abort: () => this.session.abort(),
      sendExtensionUiResponse: async (response: ExtensionUiResponse) => this.ui.respond(response),
    };
    this.acp = new PiAcpSession({
      sessionId: this.session.sessionId,
      cwd: parts.cwd,
      mcpServers: [],
      proc,
      conn: {
        sessionUpdate: async ({ update }) => this.emit(update),
        requestPermission: (params) => this.requestPermission(params),
      },
      editDiffs: parts.editDiffs,
      rejectPromptFailures: true,
    });
  }

  get agentSessionId(): string {
    return this.session.sessionId;
  }

  // ---- ACP session surface ----------------------------------------------------------------- //

  onEvent(listener: Listener<SessionEvent>): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onPermissionRequest(listener: Listener<SessionPermissionRequest>): () => void {
    this.permissionListeners.add(listener);
    return () => this.permissionListeners.delete(listener);
  }

  /**
   * Run one prompt. A prompt that follows a Stop waits (bounded) for the stopped one to unwind; if
   * it has not, the new prompt is refused as not sent, rather than queued behind a turn that is
   * still stopping and run later by surprise.
   */
  async prompt(blocks: unknown[]): Promise<{ stopReason: string }> {
    if (this.stopped) {
      const unwound = await Promise.race([
        this.currentTurn.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), STOPPED_TURN_UNWIND_MS)),
      ]);
      if (!unwound) throw withPublicCode(new Error(SESSION_TURN_IN_USE_MESSAGE), SESSION_TURN_IN_USE_CODE);
      this.stopped = false;
    }
    const { message, images } = promptToPiMessage(blocks);
    this.turnStart = { leafId: this.session.sessionManager.getLeafId() };
    const silenced = new Promise<never>((_, reject) => {
      this.silence = reject;
    });
    this.watchdog.start();
    const turn = this.acp.prompt(message, images);
    this.currentTurn = turn.catch(() => {});
    try {
      const stopReason = await Promise.race([turn, silenced]);
      // A turn that ended (a Stop included) belongs to the conversation; only a failure may be
      // rolled back.
      if (stopReason !== "error") this.turnStart = undefined;
      return { stopReason };
    } finally {
      this.watchdog.stop();
      this.silence = undefined;
      this.parts.onTurnEnd(this.session.sessionManager.getSessionFile());
      // The turn ends only once its file is on the drive: a runner that dies after the person saw
      // the answer must not resume without it.
      await this.saveTranscript();
    }
  }

  /**
   * False when the latest save of the conversation file failed or did not finish in time. The
   * turn still counts for the person, but the drive's file may lack it, so the caller must not
   * make it a native resume point: the next cold resume rebuilds from the conversation's records.
   * The next save that lands (it puts the whole file) makes the file trusted again.
   */
  nativeHistorySaved(): boolean {
    return this.historySaved;
  }

  /** Put the conversation file on the drive, bounded; false (and logged) when it did not land in time. */
  private async saveTranscript(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      this.parts.saveTranscript().then(
        () => undefined,
        (err: unknown) => String(err).slice(0, 160),
      ),
      new Promise<string>((r) => {
        timer = setTimeout(() => r(`not done after ${this.parts.transcriptSaveTimeoutMs} ms`), this.parts.transcriptSaveTimeoutMs);
      }),
    ]);
    clearTimeout(timer);
    this.historySaved = outcome === undefined;
    if (outcome !== undefined) {
      this.parts.log(
        `[inprocess] conversation file not saved to the drive (${outcome}) session=${this.id}; ` +
          "the next cold resume rebuilds from the conversation's records",
      );
    }
    return this.historySaved;
  }

  /**
   * Take what the agent did in the latest turn out of the conversation after it failed: the
   * transcript goes back to the person's message of that turn, so the next turn sends the model
   * the completed turns and that question, without the failed turn's tool calls, results and
   * error. Without this, whatever made the provider refuse (usually a tool result) stays in the
   * history and every later turn is refused too. The cold replay applies the same rule
   * (`reconstructMessages`). The failed entries stay in the
   * session file on an abandoned branch; a marker entry after the rollback point makes a reload
   * resume from there. Returns false when it cannot vouch for the transcript (no prompt ran, Pi
   * does not settle, or the rolled-back file did not reach the drive), and the caller then falls
   * back to a cold replay.
   */
  async rollbackFailedTurn(): Promise<boolean> {
    const start = this.turnStart;
    this.turnStart = undefined;
    if (!start) return false;
    const idle = await Promise.race([
      this.session.agent.waitForIdle().then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((r) => setTimeout(() => r(false), DISPOSE_UNWIND_MS).unref()),
    ]);
    if (!idle) return false;
    const manager = this.session.sessionManager;
    const failedFrom = manager.getLeafId();
    const keepTo = failedFrom === null ? null : (this.turnQuestion(manager.getBranch(failedFrom), start.leafId) ?? start.leafId);
    // Nothing to drop, but the turn's question may still be only on the runner's disk: the turn is
    // a resume point only once its file is on the drive.
    if (failedFrom === keepTo) return this.saveTranscript();
    if (keepTo === null) manager.resetLeaf();
    else manager.branch(keepTo);
    manager.appendCustomEntry(FAILED_TURN_ROLLBACK_ENTRY, { abandonedLeafId: failedFrom });
    // Pi 0.87 makes the session manager canonical for provider context: assigning
    // `agent.state.messages` no longer changes the next request, so re-project from the manager.
    this.session.refreshContext();
    this.parts.log(`[inprocess] failed turn rolled back session=${this.id}`);
    return this.saveTranscript();
  }

  /** The id of the person's message the turn started with: the first user message after `startLeafId` on `branch` (root first). */
  private turnQuestion(branch: Array<{ id: string; type: string; message?: { role?: string } }>, startLeafId: string | null): string | undefined {
    const from = startLeafId === null ? 0 : branch.findIndex((entry) => entry.id === startLeafId) + 1;
    if (from <= 0 && startLeafId !== null) return undefined;
    return branch.slice(from).find((entry) => entry.type === "message" && entry.message?.role === "user")?.id;
  }

  /** ACP cancel is a notification: the prompt settles on its own as "cancelled". */
  async cancel(): Promise<void> {
    this.stopped = true;
    for (const [id, pending] of this.pendingPermissions) {
      this.pendingPermissions.delete(id);
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    await this.acp.cancel().catch(() => {});
  }

  /** sandbox-agent's reply vocabulary: `once`, `always`, `reject`. */
  async respondPermission(permissionId: string, reply: string): Promise<void> {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) return;
    // sandbox-agent picks the first option of the matching kind for a reply.
    const kinds =
      reply === "always" ? ["allow_always", "allow_once"] : reply === "once" ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
    const option = kinds.map((kind) => pending.options.find((o) => o.kind === kind)).find(Boolean);
    this.settlePermission(permissionId, option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } });
  }

  private settlePermission(permissionId: string, outcome: PermissionOutcome): void {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) return;
    this.pendingPermissions.delete(permissionId);
    pending.resolve(outcome);
  }

  async getConfigOptions(): Promise<Array<Record<string, unknown>>> {
    const models = await this.runtime.getAvailable();
    const current = this.session.model;
    return [
      {
        id: "model",
        category: "model",
        type: "select",
        currentValue: current ? `${current.provider}/${current.id}` : undefined,
        options: models.map((m) => ({ value: `${m.provider}/${m.id}`, name: m.name })),
      },
    ];
  }

  /** Only models the runtime knows (the run's models.json or Pi's catalog); no guessing. */
  async setModel(wanted: string): Promise<{ configOptions: Array<Record<string, unknown>> }> {
    const slash = wanted.indexOf("/");
    const model = slash > 0 ? this.runtime.getModel(wanted.slice(0, slash), wanted.slice(slash + 1)) : undefined;
    if (!model) throw modelUnavailableError(wanted);
    await this.session.setModel(model);
    return { configOptions: await this.getConfigOptions() };
  }

  async setConfigOption(configId: string, value: string): Promise<{ configOptions: Array<Record<string, unknown>> }> {
    if (configId === "model") return this.setModel(value);
    return { configOptions: await this.getConfigOptions() };
  }

  /** The saved conversation as ACP updates, exactly as pi-acp's `session/load` replays it. */
  async replayHistory(): Promise<number> {
    const messages = this.session.messages ?? [];
    await replayPiMessages(messages, async (update) => this.emit(update));
    return messages.length;
  }

  /** Stop and release; waits a bounded time for Pi to unwind. */
  async dispose(): Promise<void> {
    await this.cancel();
    this.ui.cancelAll();
    await Promise.race([this.session.agent.waitForIdle().catch(() => {}), new Promise((r) => setTimeout(r, DISPOSE_UNWIND_MS))]);
    this.watchdog.stop();
    this.unsubscribe();
    this.session.dispose();
    await this.parts.cleanup().catch(() => {});
  }

  toRecord(): SessionRecord {
    return {
      id: this.id,
      agent: this.agent,
      agentSessionId: this.agentSessionId,
      lastConnectionId: CONNECTION_ID,
      createdAt: this.createdAt,
    };
  }

  // ---- Runner side of pi-acp's client connection -------------------------------------------- //

  private emit(update: Record<string, unknown>): void {
    const index = this.eventIndex++;
    const event: SessionEvent = {
      id: `${this.id}:${index}`,
      eventIndex: index,
      sessionId: this.id,
      createdAt: Date.now(),
      connectionId: CONNECTION_ID,
      sender: "agent",
      payload: { jsonrpc: "2.0", method: "session/update", params: { sessionId: this.agentSessionId, update } },
    };
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        this.parts.log(`[inprocess] event listener threw: ${String(err).slice(0, 160)}`);
      }
    }
  }

  private requestPermission(params: { toolCall: DialogToolCall; options: PermissionOption[] }): Promise<PermissionOutcome> {
    const id = randomUUID();
    const request: SessionPermissionRequest = {
      id,
      createdAt: Date.now(),
      sessionId: this.id,
      agentSessionId: this.agentSessionId,
      availableReplies: ["once", "reject"],
      options: params.options,
      toolCall: params.toolCall,
      rawRequest: { sessionId: this.agentSessionId, toolCall: params.toolCall, options: params.options },
    };
    return new Promise<PermissionOutcome>((resolve) => {
      // sandbox-agent cancels a permission request nobody listens for.
      if (this.permissionListeners.size === 0) {
        resolve({ outcome: { outcome: "cancelled" } });
        return;
      }
      this.watchdog.dialogOpened();
      this.pendingPermissions.set(id, {
        options: params.options,
        resolve: (outcome) => {
          this.watchdog.dialogClosed();
          resolve(outcome);
        },
      });
      for (const listener of this.permissionListeners) {
        try {
          listener(request);
        } catch (err) {
          this.parts.log(`[inprocess] permission listener threw: ${String(err).slice(0, 160)}`);
        }
      }
    });
  }
}
