/** The environment boundaries the runner emits on a cold acquire (#6047), in emission order. */
export type StartupPhase =
    | "environment_starting"
    | "preparing_workspace"
    | "opening_session"
    | "environment_ready"

/** The turn this tab waits on: unnamed send, admitted turn (a warm one stays here), or a phase. */
export type TurnStage = "sending" | "started" | StartupPhase

/** Words shown once in order, then cycled for as long as the stage lasts. */
export interface StageWords {
    lead: readonly string[]
    loop: readonly string[]
}

/** A turn whose stage is unknown or carries no narration of its own. Claims nothing specific. */
export const WORKING_WORDS: StageWords = {lead: [], loop: ["Working", "Thinking", "Still working"]}

// create_session (`opening_session`) is ~78% of a cold start, so it gets the longest loop.
const STAGE_WORDS: Record<TurnStage, StageWords> = {
    sending: {lead: [], loop: ["Sending"]},
    started: WORKING_WORDS,
    environment_starting: {
        lead: ["Getting things ready"],
        loop: ["Starting the sandbox", "Setting up the environment"],
    },
    preparing_workspace: {lead: ["Loading details"], loop: ["Preparing the workspace"]},
    opening_session: {
        lead: ["Almost there"],
        loop: ["Opening the agent session", "Starting the agent", "Still starting up"],
    },
    // Nothing more is starting up; the turn itself is the work now.
    environment_ready: WORKING_WORDS,
}

/** How long each word holds before the next one. */
export const STAGE_WORD_MS = 2_000

// `in` would also accept inherited keys such as "toString".
const hasOwn = (key: string): key is TurnStage =>
    Object.prototype.hasOwnProperty.call(STAGE_WORDS, key)

export const stageWords = (stage: string | null): StageWords =>
    stage && hasOwn(stage) ? STAGE_WORDS[stage] : WORKING_WORDS

export const stageWordAt = ({lead, loop}: StageWords, tick: number): string =>
    tick < lead.length ? lead[tick] : loop[(tick - lead.length) % loop.length]

const STARTUP_PHASES: ReadonlySet<string> = new Set<StartupPhase>([
    "environment_starting",
    "preparing_workspace",
    "opening_session",
    "environment_ready",
])

export const startupPhaseFromDataPart = (part: unknown): StartupPhase | null => {
    if (!part || typeof part !== "object") return null
    const candidate = part as {type?: unknown; data?: {phase?: unknown}}
    if (candidate.type !== "data-agent-status") return null
    const phase = candidate.data?.phase
    return typeof phase === "string" && STARTUP_PHASES.has(phase) ? (phase as StartupPhase) : null
}
