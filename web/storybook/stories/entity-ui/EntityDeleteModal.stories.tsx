import {useMemo} from "react"

// Value import + void: registers the testset/revision modal adapters the delete modal
// resolves names with. A bare side-effect import is dropped — entity-ui declares
// `sideEffects: false`.
import {testsetModalAdapter} from "@agenta/entity-ui/adapters"
import {
    EntityDeleteModal,
    createEntityAdapter,
    deleteModalEntitiesAtom,
    deleteModalErrorAtom,
    deleteModalOpenAtom,
    registerEntityAdapter,
    resetDeleteModalAtom,
} from "@agenta/entity-ui/modals"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {atom, getDefaultStore} from "jotai"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {testsetQueries} from "../../fixtures/entityModals"

// Keep the adapter registration alive under sideEffects:false tree-shaking.
void testsetModalAdapter

/**
 * **Data-connected modal story.** EntityDeleteModal groups its entities by type and
 * resolves display names through the registered modal adapters (`adapter.dataAtom` →
 * molecule → query cache). Stories that need resolved names seed the testset detail query;
 * stories passing `EntityReference.name` need no fixture at all.
 *
 * The warning/blocked/error branches are unreachable live — every registered adapter
 * returns `canDelete: true` and no warning — so `BlockedAndWarnings` registers a
 * story-local adapter for the (otherwise unregistered) `evaluator` type to reach them.
 */
const meta = {
    title: "@agenta/entity-ui/Modals/EntityDeleteModal",
    component: EntityDeleteModal,
    // The modal portals to <body>; a docs page rendering all stories would stack dialogs.
    tags: ["!autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Delete confirmation modal. Data-connected: entities group by type and " +
                    "resolve names via the modal adapters.",
            },
        },
    },
} satisfies Meta<typeof EntityDeleteModal>

export default meta
type Story = StoryObj<typeof meta>

const DELETE_RESET: [typeof resetDeleteModalAtom, null][] = [[resetDeleteModalAtom, null]]

/**
 * Story-local adapter for the `evaluator` type (registered by no product code): blocks
 * deletion and emits a warning, reaching EntityDeleteContent's warning + blocked alerts.
 */
registerEntityAdapter(
    createEntityAdapter({
        type: "evaluator",
        getDisplayName: () => "Exact match (built-in)",
        deleteAtom: atom(null, async () => {}),
        dataAtom: () => atom(() => ({})),
        canDelete: () => false,
        getDeleteWarning: () => "Built-in evaluators are shared by every project member.",
    }),
)

/** Internal-control seeding for the error branch. */
function WithDeleteError({
    entities,
    error,
    children,
}: {
    entities: {type: "testset"; id: string; name: string}[]
    error: Error
    children: React.ReactNode
}) {
    useMemo(() => {
        const store = getDefaultStore()
        store.set(deleteModalEntitiesAtom, entities)
        store.set(deleteModalErrorAtom, error)
        store.set(deleteModalOpenAtom, true)
    }, [entities, error])
    return <>{children}</>
}

/**
 * Mixed types with names provided on the references. The names render from the refs, but
 * the adapter's `dataAtom` still MOUNTS the testset query per entity, so the cache is
 * seeded anyway (the decorator's missing-fixture log flags the keys otherwise).
 */
export const Default: Story = {
    args: {open: true, onClose: () => {}},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                testsetQueries(scope, [
                    {idKey: "ts-a", name: "Customer support cases"},
                    {idKey: "ts-b", name: "Regression prompts"},
                ]),
            args: (scope: StoryScope) => ({
                entities: [
                    {type: "testset", id: scope.id("ts-a"), name: "Customer support cases"},
                    {type: "testset", id: scope.id("ts-b"), name: "Regression prompts"},
                    {type: "revision", id: scope.id("rev-a"), name: "v4"},
                ],
            }),
            reset: DELETE_RESET,
        },
    },
}

/**
 * References WITHOUT names: the modal resolves them via the testset adapter's `dataAtom`,
 * i.e. from the seeded `["testset", projectId, id]` cache entries.
 */
export const AdapterResolvedNames: Story = {
    args: {open: true, onClose: () => {}},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                testsetQueries(scope, [
                    {idKey: "ts-a", name: "Customer support cases"},
                    {idKey: "ts-b", name: "Regression prompts"},
                ]),
            args: (scope: StoryScope) => ({
                entities: [
                    {type: "testset", id: scope.id("ts-a")},
                    {type: "testset", id: scope.id("ts-b")},
                ],
            }),
            reset: DELETE_RESET,
        },
    },
}

/**
 * Warning + blocked alerts via the story-local `evaluator` adapter — branches no
 * registered product adapter can reach (they all allow deletion).
 */
export const BlockedAndWarnings: Story = {
    args: {open: true, onClose: () => {}},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                testsetQueries(scope, [{idKey: "ts-a", name: "Customer support cases"}]),
            args: (scope: StoryScope) => ({
                entities: [
                    {type: "testset", id: scope.id("ts-a"), name: "Customer support cases"},
                    {type: "evaluator", id: scope.id("eval-a")},
                ],
            }),
            reset: DELETE_RESET,
        },
    },
}

/** The delete-failed branch, seeded directly (live it needs a failed round-trip). */
export const ErrorState: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                testsetQueries(scope, [{idKey: "ts-a", name: "Customer support cases"}]),
            args: (scope: StoryScope) => ({
                errorEntities: [
                    {type: "testset", id: scope.id("ts-a"), name: "Customer support cases"},
                ],
            }),
            reset: DELETE_RESET,
        },
    },
    render: (args) => (
        <WithDeleteError
            entities={
                (args as {errorEntities?: {type: "testset"; id: string; name: string}[]})
                    .errorEntities ?? []
            }
            error={new Error("Testset is referenced by a running evaluation.")}
        >
            <EntityDeleteModal />
        </WithDeleteError>
    ),
}
