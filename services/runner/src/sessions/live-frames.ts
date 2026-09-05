import type { AgentEvent } from "../protocol.ts";
import { apiBase } from "../apiBase.ts";

export const LIVE_FRAMES_ENV = "AGENTA_RUNNER_LIVE_FRAMES";
export const LIVE_FRAME_BUFFER_CAPACITY = 256;

export interface LiveFrameEnvelope {
  version: 1;
  kind: "frame";
  session_id: string;
  execution_id: string;
  frame_or_event_id: string;
  frame_index: number;
  entity_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface ProjectedFrame {
  entityId: string;
  type: string;
  payload: Record<string, unknown>;
}

interface LiveFramePublisherOptions {
  sessionId: string;
  executionId: string;
  auth: () => string;
  enabled?: boolean;
  capacity?: number;
  send?: (frame: LiveFrameEnvelope) => Promise<void>;
  now?: () => string;
  log?: (message: string) => void;
}

function envEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(process.env[LIVE_FRAMES_ENV] ?? "")
      .trim()
      .toLowerCase(),
  );
}

async function postFrame(
  auth: () => string,
  frame: LiveFrameEnvelope,
): Promise<void> {
  const response = await fetch(`${apiBase()}/sessions/records/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: auth(),
    },
    body: JSON.stringify(frame),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

function projectEvent(
  event: AgentEvent,
  seenToolCalls: Set<string>,
): ProjectedFrame[] {
  switch (event.type) {
    case "message_start":
      return [{ entityId: event.id, type: "text-start", payload: { id: event.id } }];
    case "message_delta":
      return [
        {
          entityId: event.id,
          type: "text-delta",
          payload: { id: event.id, delta: event.delta },
        },
      ];
    case "message_end":
      return [{ entityId: event.id, type: "text-end", payload: { id: event.id } }];
    case "thought_start":
      return [
        { entityId: event.id, type: "reasoning-start", payload: { id: event.id } },
      ];
    case "thought_delta":
      return [
        {
          entityId: event.id,
          type: "reasoning-delta",
          payload: { id: event.id, delta: event.delta },
        },
      ];
    case "thought_end":
      return [
        { entityId: event.id, type: "reasoning-end", payload: { id: event.id } },
      ];
    case "tool_call": {
      if (!event.id) return [];
      const payload = {
        toolCallId: event.id,
        toolName: event.name,
        input: event.input ?? {},
      };
      const input = {
        entityId: event.id,
        type: "tool-input-available",
        payload,
      };
      if (seenToolCalls.has(event.id)) return [input];
      seenToolCalls.add(event.id);
      return [
        {
          entityId: event.id,
          type: "tool-input-start",
          payload: { toolCallId: event.id, toolName: event.name },
        },
        input,
      ];
    }
    case "tool_result": {
      if (!event.id || !seenToolCalls.has(event.id)) return [];
      if (event.denied) {
        return [
          {
            entityId: event.id,
            type: "tool-output-denied",
            payload: { toolCallId: event.id },
          },
        ];
      }
      if (event.isError) {
        return [
          {
            entityId: event.id,
            type: "tool-output-error",
            payload: { toolCallId: event.id, errorText: event.output ?? "" },
          },
        ];
      }
      return [
        {
          entityId: event.id,
          type: "tool-output-available",
          payload: {
            toolCallId: event.id,
            output: event.data ?? event.output,
          },
        },
      ];
    }
    default:
      return [];
  }
}

export class LiveFramePublisher {
  private readonly enabled: boolean;
  private readonly capacity: number;
  private readonly send: (frame: LiveFrameEnvelope) => Promise<void>;
  private readonly now: () => string;
  private readonly log: (message: string) => void;
  private readonly sessionId: string;
  private readonly executionId: string;
  private readonly queue: LiveFrameEnvelope[] = [];
  private readonly seenToolCalls = new Set<string>();
  private frameIndex = 0;
  private dropped = 0;
  private pumping = false;
  private idleWaiters: Array<() => void> = [];

  constructor(options: LiveFramePublisherOptions) {
    this.enabled = options.enabled ?? envEnabled();
    this.capacity = Math.max(1, options.capacity ?? LIVE_FRAME_BUFFER_CAPACITY);
    this.sessionId = options.sessionId;
    this.executionId = options.executionId;
    this.send =
      options.send ?? ((frame) => postFrame(options.auth, frame));
    this.now = options.now ?? (() => new Date().toISOString());
    this.log =
      options.log ??
      ((message) => process.stderr.write(`[sessions/live-frames] ${message}\n`));
  }

  emit(event: AgentEvent): void {
    if (!this.enabled) return;
    for (const projected of projectEvent(event, this.seenToolCalls)) {
      const index = this.frameIndex++;
      const frame: LiveFrameEnvelope = {
        version: 1,
        kind: "frame",
        session_id: this.sessionId,
        execution_id: this.executionId,
        frame_or_event_id: `${this.executionId}:${index}`,
        frame_index: index,
        entity_id: projected.entityId,
        type: projected.type,
        payload: projected.payload,
        created_at: this.now(),
      };
      if (this.queue.length >= this.capacity) {
        this.dropped += 1;
        continue;
      }
      this.queue.push(frame);
    }
    this.startPump();
  }

  reportDrops(): number {
    const dropped = this.dropped;
    if (dropped > 0) {
      this.log(
        `DROPPED session=${this.sessionId} execution=${this.executionId} count=${dropped}`,
      );
      this.dropped = 0;
    }
    return dropped;
  }

  async whenIdle(): Promise<void> {
    if (!this.pumping && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private startPump(): void {
    if (this.pumping || this.queue.length === 0) return;
    this.pumping = true;
    void this.pump();
  }

  private async pump(): Promise<void> {
    while (this.queue.length > 0) {
      const frame = this.queue.shift();
      if (!frame) break;
      try {
        await this.send(frame);
      } catch {
        this.dropped += 1;
      }
    }
    this.pumping = false;
    if (this.queue.length > 0) {
      this.startPump();
      return;
    }
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
