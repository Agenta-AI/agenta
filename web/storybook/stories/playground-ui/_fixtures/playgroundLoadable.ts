/**
 * Execution-graph seed for the `ExecutionItems` family.
 *
 * These components render NOTHING without a loadable. `generationRowIdsAtom`
 * (playground `state/execution/selectors.ts`) derives every row from
 * `derivedLoadableIdAtom`, which is `testset:{entityType}:{entityId}` of the first
 * depth-0 node in `playgroundNodesAtom`. No node ⇒ no loadable ⇒ no rows ⇒ blank render,
 * which passes the VRT and axe. So the seed has to build the graph, not just the cache.
 *
 * ## What it seeds, and through which supported door
 *
 * 1. **The query cache** — one `["workflows","revision", id, projectId]` entry per entity.
 *    That is what `workflowMolecule` reads, and it decides three things at once: whether
 *    `workflowMolecule.selectors.query(id)` stops being `isPending` (ExecutionItems shows a
 *    skeleton until it does), whether the app is chat or completion (`flags.is_chat`, or a
 *    `messages` property on the input schema), and which variable rows exist
 *    (`data.schemas.inputs.properties`).
 * 2. **The playground graph** — `playgroundController.actions.addPrimaryNode`, then
 *    `setEntityIds` for comparison. `addPrimaryNode` also links the loadable to the runnable,
 *    which is what makes `testcaseMolecule` rows belong to this playground.
 * 3. **The sessions** — `executionController.actions.initSessions`, one per entity. Comparison
 *    mode is decided by the ACTIVE SESSION count, not by how many entities are selected.
 * 4. **The rows** — `loadableController.actions.addRow` for completion (it returns the minted
 *    testcase id, which results have to be keyed by), `addUserMessageAtom` / `addMessageAtom`
 *    for chat turns.
 * 5. **The results** — `startRunAtom` / `completeRunAtom` / `failRunAtom`, keyed by
 *    `buildResultKey(rowId, "sess:" + entityId)`. That is the same key the runner writes, so
 *    a seeded result is indistinguishable from a real one to every reader.
 *
 * Nothing here reaches into the writable execution atoms (`executionStateAtomFamily` and
 * friends). They are not on `@agenta/playground/state`'s surface and this fixture does not
 * need them.
 *
 * ## Isolation
 *
 * `testcaseMolecule` rows and the chat message store are GLOBAL, not per-story, and jotai's
 * default store is shared across stories (see `withAgentaData`). So `seedGraphAtom` starts by
 * clearing both, and each story must pass its own entity ids — two stories sharing an id share
 * a loadable. `entityIds()` builds ids from a story-unique prefix for exactly that reason.
 *
 * ## Usage
 *
 *     parameters: {agenta: seedPlaygroundLoadable({
 *         entities: [{id: "single-classify", label: "classify", variables: ["ticket"]}],
 *         rows: [{ticket: "Where is my refund?"}],
 *         results: [{row: 0, entity: "single-classify", output: "billing"}],
 *     })}
 *
 * Ids are suffixed with the caller's prefix, so read them back with `entityIds(prefix)` when a
 * story needs to pass `entityId` as a prop.
 */

import {createElement, type ReactNode} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {executionController, playgroundController} from "@agenta/playground"
import {
    addMessageAtom,
    addUserMessageAtom,
    buildResultKey,
    clearAllMessagesAtom,
    completeRunAtom,
    executionRowIdsAtom,
    failRunAtom,
    resetExecutionAtom,
    setRepetitionCountAtom,
    startRunAtom,
} from "@agenta/playground/state"
import {PlaygroundUIProvider, type PlaygroundUIProviders} from "@agenta/playground-ui/context"
import {atom, useAtomValue, type WritableAtom} from "jotai"

type QueryFixture = [unknown[], unknown]

/**
 * The app-injected slots these components read through `usePlaygroundUIOptional`.
 * Every one is optional at the call site, but the three required by the type must exist, so
 * the harness supplies inert stand-ins rather than chasing OSS components into the story.
 * `SharedGenerationResultUtils` is the exception worth keeping visible: it is what renders
 * the metrics strip under a completed run, so a story with results shows something there.
 */
const storyProviders: PlaygroundUIProviders = {
    EntityDrillInView: () => null,
    SharedGenerationResultUtils: ({traceId}) =>
        createElement(
            "span",
            {className: "text-xs text-colorTextSecondary"},
            traceId ? `trace ${traceId}` : "",
        ),
    CommitVariantChangesButton: () => null,
}

/** Wraps a story in the injection context the ExecutionItems tree expects. */
export const StoryPlaygroundUIProvider = ({children}: {children: ReactNode}) =>
    // `children` goes in the props object, not the third argument: PlaygroundUIProviderProps
    // declares it required, and createElement's overload does not fill it from the rest args.
    createElement(PlaygroundUIProvider, {providers: storyProviders, children})

export interface SeedEntity {
    /** Revision id. Must be unique across stories — it keys the loadable. */
    id: string
    /** Variant label shown in row headers and comparison column headers. */
    label?: string
    version?: number
    /** Chat capability. Sets `flags.is_chat`, which flips the whole surface to chat mode. */
    chat?: boolean
    /** Completion input variables — one variable card per name. */
    variables?: string[]
    /** Read-only prompt messages ChatMode lists above the conversation. */
    promptMessages?: {role: string; content: string}[]
}

export interface SeedResult {
    /** Index into `rows` (completion) or `turns` (chat). */
    row: number
    /** Entity id the result belongs to. */
    entity: string
    /**
     * The model's answer. Wrapped into the runner's `{response: {data}}` envelope, because
     * `deriveToolViewModelFromResult` reads `result.response.data` and renders NOTHING for a
     * bare string — the row shows an empty output card instead of the placeholder, which is
     * exactly the silent failure this fixture exists to avoid.
     */
    output?: unknown
    error?: string
    /** Leaves the run in `running` state — the spinner/cancel path. */
    running?: boolean
    traceId?: string
}

export interface SeedOptions {
    /** First entity is the anchor: it owns the loadable id. More than one ⇒ comparison. */
    entities: SeedEntity[]
    /** Completion test cases, in order. */
    rows?: Record<string, unknown>[]
    /** Chat turns, in order. `replies` is keyed by entity id. */
    turns?: {user: string; replies?: Record<string, string>}[]
    results?: SeedResult[]
    repetitionCount?: number
}

/** Story-unique ids for a seed. Stories pass the same prefix to seed and to props. */
export const entityIds = (prefix: string, count = 1): string[] =>
    Array.from({length: count}, (_, i) => `${prefix}-rev-${i + 1}`)

/**
 * Chat turn ids are deterministic, so a story can pass one to `ChatTurnView` as a prop.
 * Completion row ids are NOT — `addRow` mints them — so read those with `useSeededRowIds`.
 */
export const turnIdFor = (anchorEntityId: string, index: number) =>
    `${anchorEntityId}-turn-${index}`

/** The seeded rows (completion) or turns (chat) of the current story, in render order. */
export const useSeededRowIds = (): string[] => useAtomValue(executionRowIdsAtom)

const sessionIdFor = (entityId: string) => `sess:${entityId}`

/** The shape `workflowMolecule` expects under `["workflows","revision", id, projectId]`. */
function revisionFor(entity: SeedEntity) {
    const variables = entity.variables ?? []
    const properties: Record<string, unknown> = Object.fromEntries(
        variables.map((name) => [name, {type: "string", title: name}]),
    )
    // A `messages` input port is the schema half of chat detection; the flag is the other.
    if (entity.chat) properties.messages = {type: "array", title: "messages"}

    return {
        id: entity.id,
        workflow_id: `wf-${entity.id}`,
        slug: entity.label ?? entity.id,
        name: entity.label ?? entity.id,
        version: entity.version ?? 1,
        message: "Seeded revision",
        created_at: "2026-07-14T16:30:00Z",
        created_by_id: "user-ashraf",
        flags: {is_chat: Boolean(entity.chat), is_evaluator: false, is_custom: false},
        data: {
            parameters: {
                prompt: {
                    messages: entity.promptMessages ?? [],
                    llm_config: {model: "gpt-4o-mini"},
                    template_format: "curly",
                },
            },
            schemas: {
                inputs: {type: "object", properties},
            },
        },
    }
}

function queriesFor(entities: SeedEntity[], projectId: string): QueryFixture[] {
    return entities.flatMap((entity) => {
        const revision = revisionFor(entity)
        return [
            [["workflows", "revision", entity.id, projectId], revision],
            [
                ["workflows", "detail", projectId, revision.workflow_id],
                {id: revision.workflow_id, slug: revision.slug, name: revision.name},
            ],
        ] as QueryFixture[]
    })
}

/**
 * One write that builds the whole graph. It has to be a single atom because
 * `parameters.agenta.atoms` seeds through `store.set(atom, value)` — one value, one call —
 * and the steps below are order-dependent (nodes before rows, rows before results).
 */
const seedGraphAtom = atom(null, (get, set, options: SeedOptions) => {
    const {entities, rows = [], turns = [], results = [], repetitionCount} = options
    const anchor = entities[0]
    if (!anchor) return
    const loadableId = `testset:workflow:${anchor.id}`

    // The testcase store and the chat store are global — wipe the previous story's rows first.
    for (const id of get(testcaseMolecule.atoms.displayRowIds)) {
        set(testcaseMolecule.actions.delete, id)
    }
    set(clearAllMessagesAtom, {loadableId})
    set(resetExecutionAtom, {loadableId})

    // `skipInitialRow` because this fixture always sets rows explicitly below.
    set(
        playgroundController.actions.addPrimaryNode,
        {type: "workflow", id: anchor.id, label: anchor.label ?? anchor.id},
        {skipInitialRow: true},
    )
    if (entities.length > 1) {
        set(
            playgroundController.actions.setEntityIds,
            entities.map((entity) => entity.id),
        )
    }

    // One execution session per entity. `isCompareModeWithContext` counts ACTIVE SESSIONS, not
    // selected entities — without this, a two-entity playground still routes to `SingleLayout`.
    set(executionController.actions.initSessions, {
        loadableId,
        sessions: entities.map((entity) => ({
            id: sessionIdFor(entity.id),
            runnableId: entity.id,
            runnableType: "workflow" as const,
            mode: anchor.chat ? ("chat" as const) : ("completion" as const),
            label: entity.label ?? entity.id,
        })),
    })

    // Completion rows, one `addRow` each — it RETURNS the generated testcase id, and results
    // have to be keyed by that id. Reading `displayRowIds` back mid-write does not see the
    // additions, so the returned ids are the only reliable source.
    const rowIds = rows.map(
        (data) => set(loadableController.actions.addRow, loadableId, data) as string,
    )

    // Chat turns. The user message is the turn id; replies hang off it per session.
    const turnIds: string[] = []
    turns.forEach((turn, index) => {
        const turnId = set(addUserMessageAtom, {
            loadableId,
            id: turnIdFor(anchor.id, index),
            userMessage: {role: "user", content: turn.user},
        }) as string
        turnIds.push(turnId)
        for (const [entityId, content] of Object.entries(turn.replies ?? {})) {
            set(addMessageAtom, {
                loadableId,
                message: {
                    id: `${turnId}-a-${entityId}`,
                    role: "assistant",
                    content,
                    sessionId: sessionIdFor(entityId),
                    parentId: turnId,
                },
            })
        }
    })

    if (repetitionCount !== undefined) set(setRepetitionCountAtom, repetitionCount)

    // Results are keyed by the SAME key the runner uses, so every reader sees a real run.
    const stepIds = turns.length > 0 ? turnIds : rowIds
    for (const result of results) {
        const stepId = stepIds[result.row]
        if (!stepId) continue
        const sessionId = sessionIdFor(result.entity)
        set(startRunAtom, {loadableId, stepId, sessionId, runId: `run-${stepId}-${result.entity}`})
        if (result.running) continue
        if (result.error) {
            set(failRunAtom, {
                loadableId,
                stepId,
                sessionId,
                error: {message: result.error},
                traceId: result.traceId ?? null,
            })
            continue
        }
        set(completeRunAtom, {
            loadableId,
            stepId,
            sessionId,
            result: {
                output: {response: {data: result.output}},
                traceId: result.traceId ?? null,
                resultHash: buildResultKey(stepId, sessionId),
            },
        })
    }
})

export interface AgentaSeedParameters {
    session: false
    queries: (scope: {projectId: string}) => QueryFixture[]
    atoms: [WritableAtom<null, [SeedOptions], void>, SeedOptions][]
}

/**
 * Build the `parameters.agenta` block for an execution-graph story.
 *
 * `session: false` is mandatory here for the reason `LoadModeContent.stories.tsx` documents:
 * a per-query `refetchOnMount` beats the story client's default, so an open auth gate lets a
 * seeded query refetch against the real API and replace the fixture with an error.
 */
export function seedPlaygroundLoadable(options: SeedOptions): AgentaSeedParameters {
    return {
        session: false,
        queries: (scope) => queriesFor(options.entities, scope.projectId),
        atoms: [[seedGraphAtom, options]],
    }
}
