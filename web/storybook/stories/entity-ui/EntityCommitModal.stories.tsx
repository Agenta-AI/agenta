import {useMemo} from "react"

import {workflowDraftAtomFamily, type Workflow} from "@agenta/entities/workflow"
// Value import + void (below): registers the variant modal adapter the commit modal
// resolves entities through. A bare side-effect import is dropped — entity-ui declares
// `sideEffects: false`. (EntityCommitModal also registers these itself; kept explicit.)
import {variantModalAdapter} from "@agenta/entity-ui/adapters"
import {
    EntityCommitModal,
    commitModalEntityAtom,
    commitModalErrorAtom,
    commitModalMessageAtom,
    commitModalOpenAtom,
    resetCommitModalAtom,
} from "@agenta/entity-ui/modals"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore} from "jotai"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {commitModalIds, commitModalQueries, draftAgentParameters} from "../../fixtures/entityModals"

// Keep the adapter registration alive under sideEffects:false tree-shaking.
void variantModalAdapter

/**
 * **Data-connected modal story.** EntityCommitModal is atom-driven end to end: the entity
 * reference, resolved display name, commit context (version info, diff, agent sections),
 * and error/loading state all come from jotai atoms + the workflow molecule. The stories
 * seed the SAME two injection points the app uses — the query cache (revision + artifact
 * queries) and, for the dirty-draft story, `workflowDraftAtomFamily`.
 *
 * Every id is story-scoped (`scope.id(…)`); the commit singletons are rewound through
 * `resetCommitModalAtom` before each story so open/message/error state cannot leak.
 */
const meta = {
    title: "@agenta/entity-ui/Modals/EntityCommitModal",
    component: EntityCommitModal,
    // The modal portals to <body>; rendering every story at once on a docs page would
    // stack the dialogs, so the autodocs page is disabled.
    tags: ["!autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Commit modal for entity revisions. Data-connected: resolves the entity " +
                    "through the registered modal adapters and the workflow molecule.",
            },
        },
    },
} satisfies Meta<typeof EntityCommitModal>

export default meta
type Story = StoryObj<typeof meta>

const variantEntity = (scope: StoryScope) =>
    ({type: "variant", id: commitModalIds(scope).revisionId}) as const

/** Rewinds the commit singletons; the L2 reset every story in this file declares. */
const COMMIT_RESET: [typeof resetCommitModalAtom, null][] = [[resetCommitModalAtom, null]]

/** Seeds a workflow draft (the dirty state the commit modal diffs) before the modal reads it. */
function WithDraft({
    revisionId,
    parameters,
    children,
}: {
    revisionId: string
    parameters: Record<string, unknown>
    children: React.ReactNode
}) {
    useMemo(() => {
        getDefaultStore().set(workflowDraftAtomFamily(revisionId), {
            data: {parameters},
        } as Partial<Workflow>)
    }, [revisionId, parameters])
    return <>{children}</>
}

/** Internal-control seeding: opens the modal via its own atoms (no external props). */
function WithCommitState({
    entityId,
    error,
    message,
    children,
}: {
    entityId: string
    error?: Error
    message?: string
    children: React.ReactNode
}) {
    useMemo(() => {
        const store = getDefaultStore()
        store.set(commitModalEntityAtom, {type: "variant", id: entityId})
        if (message !== undefined) store.set(commitModalMessageAtom, message)
        if (error) store.set(commitModalErrorAtom, error)
        store.set(commitModalOpenAtom, true)
    }, [entityId, error, message])
    return <>{children}</>
}

/**
 * A committed revision with no local edits: the wide layout with the version panel on the
 * left and the (empty) "Changes preview" JSON diff on the right.
 */
export const CleanRevision: Story = {
    args: {open: true},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => commitModalQueries(scope),
            args: (scope: StoryScope) => ({entity: variantEntity(scope)}),
            reset: COMMIT_RESET,
        },
    },
}

/**
 * The agent two-pane branch: a draft seeded into `workflowDraftAtomFamily` differs from
 * the committed revision in instructions, model, temperature, and tools, so the variant
 * adapter's commit context returns semantic `sections` and the modal renders
 * AgentChangesSummary + the section rail. The commit message is pre-filled from the
 * auto-generated summary.
 */
export const AgentChanges: Story = {
    args: {open: true},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => commitModalQueries(scope),
            args: (scope: StoryScope) => ({entity: variantEntity(scope)}),
            reset: COMMIT_RESET,
        },
    },
    render: (args) => (
        <WithDraft revisionId={args.entity!.id} parameters={draftAgentParameters()}>
            <EntityCommitModal {...args} />
        </WithDraft>
    ),
}

/** Create flow: editable name + generated slug fields (`createEntityFields`). */
export const CreateFlow: Story = {
    args: {open: true, actionLabel: "Create", createEntityFields: true},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => commitModalQueries(scope),
            args: (scope: StoryScope) => ({entity: variantEntity(scope)}),
            reset: COMMIT_RESET,
        },
    },
}

/**
 * The error branch — live it only appears after a failed commit round-trip, so it is
 * seeded directly into `commitModalErrorAtom` (internal atom control, no external props).
 */
export const ErrorState: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => commitModalQueries(scope),
            args: (scope: StoryScope) => ({entityId: commitModalIds(scope).revisionId}),
            reset: COMMIT_RESET,
        },
    },
    render: (args) => (
        <WithCommitState
            entityId={(args as {entityId?: string}).entityId ?? "rev-error"}
            message="Tighten the greeting"
            error={new Error("A resource with this slug already exists in this project.")}
        >
            <EntityCommitModal />
        </WithCommitState>
    ),
}

/**
 * No fixture at all: the revision query resolves to nothing, the adapter's commit context
 * is null, and the modal falls back to the narrow message-only layout — the empty branch
 * a live app can't normally show (it always opens the modal for a loaded revision).
 *
 * The decorator INTENTIONALLY logs two missing-fixture keys here (that is this story's
 * point): `["workflows","revision","rev-does-not-exist",projectId]` and
 * `["workflows","artifact","rev-does-not-exist",projectId]`.
 */
export const NoData: Story = {
    args: {open: true, entity: {type: "variant", id: "rev-does-not-exist"}},
    parameters: {
        agenta: {queries: [], reset: COMMIT_RESET},
    },
}
