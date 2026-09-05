/**
 * Zod boundary schemas for the durable Sessions API.
 *
 * Fern's compile-time types under-declare backend `extra="allow"` fields, so a local
 * schema still has independent drift-detection value (see `web/CLAUDE.md`). Kept loose:
 * `payload` is the opaque ACP `AgentEvent`, validated structurally by the consumer.
 *
 * The durable append-only event log the backend calls "records" (formerly "transcripts").
 */
import {z} from "zod"

/**
 * One durable, append-only record event row. Validates the wire shape (backend renamed the
 * envelope: `record_id`/`record_index`/`record_source`/`record_type`/`attributes`) and maps
 * it back to the consumer-facing names (`id`/`sender`/`payload`/…), so `transcriptToMessages`
 * keeps reading `row.payload`/`row.sender`/`row.id` and any future wire-rename stays here.
 * `payload`/`attributes` is the opaque ACP `AgentEvent`.
 */
export const sessionRecordSchema = z
    .object({
        record_id: z.string(),
        session_id: z.string(),
        project_id: z.string(),
        sequence: z.number().int().positive().nullish(),
        record_index: z.number().nullish(),
        record_source: z.string().nullish(),
        record_type: z.string().nullish(),
        attributes: z.record(z.string(), z.unknown()).nullish(),
        turn_id: z.string().nullish(),
        timestamp: z.string().nullish(),
        created_at: z.string().nullish(),
    })
    .transform((r) => ({
        id: r.record_id,
        session_id: r.session_id,
        project_id: r.project_id,
        sequence: r.sequence ?? null,
        event_index: r.record_index ?? null,
        sender: r.record_source ?? null,
        session_update: r.record_type ?? null,
        payload: r.attributes ?? null,
        turn_id: r.turn_id ?? null,
        created_at: r.created_at ?? r.timestamp ?? null,
    }))

export const sessionRecordsQueryResponseSchema = z.object({
    count: z.number(),
    records: z.array(sessionRecordSchema),
    windowing: z
        .object({
            offset: z.number().int().nonnegative(),
            limit: z.number().int().positive(),
            through_sequence: z.number().int().nonnegative(),
        })
        .nullish(),
})

export type SessionRecord = z.infer<typeof sessionRecordSchema>
export type SessionRecordsQueryResponse = z.infer<typeof sessionRecordsQueryResponseSchema>

/** A HITL request raised mid-run. `status` is the lifecycle enum (pending/responded/…). */
export const sessionInteractionSchema = z.object({
    id: z.string().nullish(),
    session_id: z.string(),
    turn_id: z.string().nullish(),
    token: z.string().nullish(),
    kind: z.string(),
    status: z.string().nullish(),
    created_at: z.string().nullish(),
    data: z
        .object({
            request: z.record(z.string(), z.unknown()).nullish(),
            references: z.record(z.string(), z.unknown()).nullish(),
            // The gated turn's stamped effective config; must be declared or zod's default
            // strip-unknown-keys would silently drop it and the resume falls back to
            // reference hydration (i.e. the wrong config). Rows written before the runner
            // started stamping simply have no key.
            parameters: z.record(z.string(), z.unknown()).nullish(),
            selector: z.record(z.string(), z.unknown()).nullish(),
            resolution: z.record(z.string(), z.unknown()).nullish(),
        })
        .nullish(),
})

export const sessionInteractionsResponseSchema = z.object({
    count: z.number().nullish(),
    interactions: z.array(sessionInteractionSchema).nullish(),
})

export const sessionInteractionResponseSchema = z.object({
    count: z.number().nullish(),
    interaction: sessionInteractionSchema.nullish(),
})

export const sessionInteractionWatchEventSchema = z.object({
    type: z.literal("interaction"),
    session_id: z.string(),
    status: z.string(),
    interactions: z.array(sessionInteractionSchema).nullish(),
})

export type SessionInteraction = z.infer<typeof sessionInteractionSchema>

/** HITL lifecycle codes. `pending` is the only actionable state. */
export type SessionInteractionStatusCode = "pending" | "responded" | "resolved" | "cancelled"
export type SessionInteractionKind = "user_approval" | "user_input" | "client_tool"

/**
 * The workflow-family keys the frontend acts on, same vocabulary the evaluation-run references
 * use. Producers and tests may lean on it; the wire is deliberately NOT validated against it.
 * The backend stores reference keys permissively, and narrowing an unrecognized key to undefined
 * would make the element read as unkeyed — handing the row back to the legacy first-id fallback
 * and the dead route it produces.
 */
export type SessionReferenceKey = "workflow" | "workflow_variant" | "workflow_revision"

/** A `{id, slug, version}` workflow/agent reference — mirrors `QuerySessionsParams.references`
 * on the request side. Every field is optional: a turn's reference may carry only a subset. */
export const sessionReferenceSchema = z.object({
    id: z.string().nullish(),
    slug: z.string().nullish(),
    version: z.string().nullish(),
    // Which family member this id is. Absent on rows written before the runner stamped it; open
    // string, see `SessionReferenceKey`. `.catch(undefined)` keeps a non-string from failing the
    // whole page's parse.
    key: z.string().nullish().catch(undefined),
})

export const sessionOriginSchema = z.enum(["manual", "trigger"])
export const sessionTriggerKindSchema = z.enum(["schedule", "subscription"])
export const sessionExpansionSchema = z.enum(["last_message", "trigger"])

export const sessionTriggerSchema = z.object({
    id: z.string(),
    kind: sessionTriggerKindSchema,
    name: z.string().nullish(),
})

export const sessionDeliverySchema = z.object({
    id: z.string(),
})

export const sessionMessagePreviewSchema = z.object({
    text: z.string(),
    source: z.string().nullish(),
    timestamp: z.string().nullish(),
})

export const sessionWindowingSchema = z.object({
    newest: z.string().nullish(),
    oldest: z.string().nullish(),
    next: z.string().nullish(),
    limit: z.number().nullish(),
    order: z.enum(["ascending", "descending"]).nullish(),
    interval: z.number().nullish(),
    rate: z.number().nullish(),
})

/**
 * A live stream handle. Liveness rides `flags` (nested: alive ⊇ running ⊇ attached);
 * `resumable` (alive & !running) and `reattachable` (running & !attached) are derived
 * client-side.
 */
export const sessionStreamSchema = z.object({
    id: z.string().nullish(),
    project_id: z.string(),
    session_id: z.string(),
    // Header (name/description) + lifecycle carry the durable session's title, order key, and
    // ended state — the merged stream row is the session-list source (WP7). `deleted_at` set = ended.
    name: z.string().nullish(),
    description: z.string().nullish(),
    turn_id: z.string().nullish(),
    stopping_turn_id: z.string().nullish(),
    // User-visible tags; attribution has dedicated typed fields below.
    tags: z.record(z.string(), z.unknown()).nullish(),
    status: z.object({code: z.string().nullish(), message: z.string().nullish()}).nullish(),
    flags: z
        .object({
            is_alive: z.boolean().nullish(),
            is_running: z.boolean().nullish(),
            is_attached: z.boolean().nullish(),
        })
        .nullish(),
    capabilities: z
        .object({
            shared_reader: z.boolean().nullish(),
        })
        .nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    deleted_at: z.string().nullish(),
    // `archived_at` set = hidden-but-recoverable (distinct from `deleted_at`=ended, still resumable).
    archived_at: z.string().nullish(),
    // `.catch(undefined)`: an unrecognized origin/trigger/delivery value must degrade this ONE
    // field to undefined, not fail the row — `sessionsQueryResponseSchema` validates the whole
    // `sessions` array in one parse, so a rejected leaf here would null out the entire page.
    origin: sessionOriginSchema.nullish().catch(undefined),
    trigger: sessionTriggerSchema.nullish().catch(undefined),
    delivery: sessionDeliverySchema.nullish().catch(undefined),
    // `/sessions/query` only (WP0-R3): the session's latest turn's workflow/agent references —
    // absent for a session with no turns yet, and for a plain stream fetch (not query'd).
    references: z.array(sessionReferenceSchema).nullish(),
    // `/sessions/query` only: the session's newest `message` record, so a row can say what
    // happened rather than only when. Absent for a session with no message yet.
    last_message: sessionMessagePreviewSchema.nullish(),
})

/** Temporary live-frame envelope. Frames are display-only and never become durable records. */
export const sessionLiveFrameSchema = z.object({
    version: z.literal(1),
    kind: z.literal("frame"),
    session_id: z.string(),
    execution_id: z.string(),
    frame_or_event_id: z.string(),
    frame_index: z.number().int().nonnegative(),
    entity_id: z.string(),
    type: z.string(),
    payload: z.record(z.string(), z.unknown()),
    created_at: z.string(),
})

/** Durable relay envelope. `watermark` is a non-negative integer: on a live event it is the
 * publishing records-worker batch's highest committed sequence for the session; on an SSE ready
 * frame the same field name is the authoritative session sequence cursor after replay. When a
 * ready frame omits it, the client keeps its requested `after` cursor. The open `type` is
 * intentional: reconnect cursors must advance past future event types even when this client does
 * not know how to render them yet. */
export const sessionDurableEventSchema = z.object({
    version: z.literal(1),
    kind: z.literal("event"),
    session_id: z.string(),
    execution_id: z.string(),
    frame_or_event_id: z.string(),
    sequence: z.number().int().positive().nullable(),
    watermark: z.number().int().nonnegative(),
    type: z.string(),
    payload: z.record(z.string(), z.unknown()),
    created_at: z.string(),
})

export const sessionDurableEventTypeSchema = z.enum([
    "execution.started",
    "execution.stopped",
    "execution.failed",
    "execution.lost",
    "message.completed",
    "tool.completed",
    "interaction.requested",
    "interaction.responded",
])

export const sessionRecordsReadStateSchema = z.object({
    latest_sequence: z.number().int().nonnegative(),
    history_complete: z.boolean(),
})

/** Atomic reconnect read: durable watermark plus lifecycle and pending-work context. */
export const sessionSnapshotSchema = z.object({
    session: sessionStreamSchema,
    execution: z.record(z.string(), z.unknown()).nullable().optional(),
    pending: z.object({
        inputs: z.array(z.unknown()).default([]),
        interactions: z.array(sessionInteractionSchema).default([]),
    }),
    read: sessionRecordsReadStateSchema,
})

export const sessionStreamsResponseSchema = z.object({
    count: z.number(),
    streams: z.array(sessionStreamSchema),
})

/** `POST /sessions/query` — the durable session list (stream rows) for the project, filtered by
 * the turns' workflow references. */
export const sessionsQueryResponseSchema = z.object({
    count: z.number(),
    total: z.number().nullish(),
    sessions: z.array(sessionStreamSchema),
    windowing: sessionWindowingSchema.nullish(),
})

export const sessionStreamResponseSchema = z.object({
    stream: sessionStreamSchema.nullish(),
    capabilities: z
        .object({
            durable_approvals: z.boolean().optional().default(false),
        })
        .optional()
        .default({durable_approvals: false}),
})

export const pendingSessionInputSchema = z.object({
    id: z.string(),
    session_id: z.string(),
    content: z.record(z.string(), z.unknown()),
    position: z.number(),
    state: z.enum(["pending", "promoted", "removed"]),
    policy: z.enum(["queue", "steer"]),
    created_at: z.string().nullish(),
    promoted_execution_id: z.string().nullish(),
})

export const sessionSnapshotResponseSchema = z.object({
    session: sessionStreamSchema.nullish(),
    execution: z
        .object({
            id: z.string().nullish(),
            state: z.enum(["idle", "running", "stopping"]).default("idle"),
        })
        .default({state: "idle"}),
    pending: z
        .object({
            inputs: z.array(pendingSessionInputSchema).default([]),
            interactions: z.array(sessionInteractionSchema).default([]),
        })
        .default({inputs: [], interactions: []}),
    capabilities: z
        .object({
            durable_approvals: z.boolean().optional().default(false),
            queue: z.boolean().optional().default(false),
            steer: z.boolean().optional().default(false),
        })
        .default({durable_approvals: false, queue: false, steer: false}),
})

/** Control-call result for the prompt × force command matrix. */
export const sessionStreamCommandResponseSchema = z.object({
    mode: z.string(),
    session_id: z.string(),
    turn_id: z.string().nullish(),
    watcher_id: z.string().nullish(),
    detached: z.boolean().nullish(),
    cancelled_turn_ids: z.array(z.string()).nullish(),
})

export const sessionCancelExecutionResponseSchema = z.union([
    z.object({
        command: z.object({id: z.string(), state: z.string()}),
        execution: z.object({
            id: z.string().nullish(),
            state: z.enum(["stopping", "idle"]),
        }),
    }),
    sessionStreamCommandResponseSchema,
])

export type SessionStream = z.infer<typeof sessionStreamSchema>
export type SessionLiveFrame = z.infer<typeof sessionLiveFrameSchema>
export type SessionDurableEvent = z.infer<typeof sessionDurableEventSchema>
export type SessionDurableEventType = z.infer<typeof sessionDurableEventTypeSchema>
export type SessionRecordsReadState = z.infer<typeof sessionRecordsReadStateSchema>
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>
export type SessionReference = z.infer<typeof sessionReferenceSchema>
export type SessionOrigin = z.infer<typeof sessionOriginSchema>
export type SessionTriggerKind = z.infer<typeof sessionTriggerKindSchema>
export type SessionExpansion = z.infer<typeof sessionExpansionSchema>
export type SessionTrigger = z.infer<typeof sessionTriggerSchema>
export type SessionDelivery = z.infer<typeof sessionDeliverySchema>
export type SessionMessagePreview = z.infer<typeof sessionMessagePreviewSchema>
export type SessionWindowing = z.infer<typeof sessionWindowingSchema>
export type SessionsQueryResponse = z.infer<typeof sessionsQueryResponseSchema>
export type SessionStreamCommandResponse = z.infer<typeof sessionStreamCommandResponseSchema>
export type PendingSessionInput = z.infer<typeof pendingSessionInputSchema>
export type SessionSnapshotResponse = z.infer<typeof sessionSnapshotResponseSchema>

/** One entry in a mount's durable file listing. `path` is relative to the mount root; folders
 * are flagged (`is_folder`) or implied by nested file paths. The backend lists the whole tree
 * under the prefix, so the one-level browse view is derived client-side (see `deriveMountRows`). */
export const mountFileSchema = z.object({
    path: z.string(),
    size: z.number().nullish(),
    is_folder: z.boolean().nullish(),
    /** Object-store LastModified as epoch ms — the recency source for "newest first" ordering. */
    mtime: z.number().nullish(),
    /** Direct-child count — set only on a folder entry the recency view rolled a freshly-written
     * directory up into (so the row can read "N items" instead of a size). */
    item_count: z.number().nullish(),
})

export const mountFileListResponseSchema = z.object({
    count: z.number().nullish(),
    /** Full file count before any `limit` — so a bounded "latest N" listing still reports the true
     * total for the UI badge. Equals `count` for an unlimited listing. */
    total: z.number().nullish(),
    /** `total` is a floor (the count-only scan hit its cap) — the UI shows "N+". */
    total_capped: z.boolean().nullish(),
    files: z.array(mountFileSchema).nullish(),
})

export const mountFileContentResponseSchema = z.object({
    path: z.string().nullish(),
    content: z.string().nullish(),
})

/** A mount row (a drive): the durable prefix bound to a session (or, later, an agent). */
export const mountSchema = z.object({
    id: z.string(),
    slug: z.string().nullish(),
    name: z.string().nullish(),
    session_id: z.string().nullish(),
})

export const sessionMountsResponseSchema = z.object({
    count: z.number().nullish(),
    mounts: z.array(mountSchema).nullish(),
})

export type MountFile = z.infer<typeof mountFileSchema>
export type Mount = z.infer<typeof mountSchema>

/** Stream lifecycle codes from `SessionStream.status.code`. */
export type StreamStatusCode = "running" | "detached" | "idle" | "ended"
/** Stream command modes (prompt × force matrix). */
export type CommandMode = "send" | "steer" | "cancel" | "attach"
