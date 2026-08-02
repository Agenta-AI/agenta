import {useMemo} from "react"

// Value import + void: registers the testset modal adapter the save modal resolves names
// with. A bare side-effect import is dropped — entity-ui declares `sideEffects: false`.
import {testsetModalAdapter} from "@agenta/entity-ui/adapters"
import {
    EntitySaveModal,
    resetSaveModalAtom,
    saveModalEntityAtom,
    saveModalErrorAtom,
    saveModalNameAtom,
    saveModalOpenAtom,
} from "@agenta/entity-ui/modals"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore} from "jotai"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {testsetQueries} from "../../fixtures/entityModals"

// Keep the adapter registration alive under sideEffects:false tree-shaking.
void testsetModalAdapter

/**
 * **Data-connected modal story.** EntitySaveModal's open flow (`openSaveModalAtom`)
 * resolves the entity's current name through the registered adapter's `dataAtom` — i.e.
 * from the testset detail query cache — and pre-fills the name input with it (plus
 * " (copy)" in save-as-new mode). The stories seed that query; the error branch is seeded
 * directly because live it needs a failed save round-trip.
 */
const meta = {
    title: "@agenta/entity-ui/Modals/EntitySaveModal",
    component: EntitySaveModal,
    // The modal portals to <body>; a docs page rendering all stories would stack dialogs.
    tags: ["!autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Save / save-as-new / create modal. Data-connected: the name field " +
                    "pre-fills from the adapter-resolved entity name.",
            },
        },
    },
} satisfies Meta<typeof EntitySaveModal>

export default meta
type Story = StoryObj<typeof meta>

const SAVE_RESET: [typeof resetSaveModalAtom, null][] = [[resetSaveModalAtom, null]]

const SEEDED_TESTSET = [{idKey: "ts-a", name: "Customer support cases"}]

/** Internal-control seeding for the error branch. */
function WithSaveError({
    entityId,
    error,
    children,
}: {
    entityId: string
    error: Error
    children: React.ReactNode
}) {
    useMemo(() => {
        const store = getDefaultStore()
        store.set(saveModalEntityAtom, {
            type: "testset",
            id: entityId,
            name: "Customer support cases",
        })
        store.set(saveModalNameAtom, "Customer support cases")
        store.set(saveModalErrorAtom, error)
        store.set(saveModalOpenAtom, true)
    }, [entityId, error])
    return <>{children}</>
}

/** Rename an existing testset: name pre-filled from the seeded testset query. */
export const SaveExisting: Story = {
    args: {open: true, onClose: () => {}},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => testsetQueries(scope, SEEDED_TESTSET),
            args: (scope: StoryScope) => ({entity: {type: "testset", id: scope.id("ts-a")}}),
            reset: SAVE_RESET,
        },
    },
}

/** Save-as-new: "<name> (copy)" pre-fill, checkbox checked, original-name hint. */
export const SaveAsNew: Story = {
    args: {open: true, saveAsNew: true, onClose: () => {}},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => testsetQueries(scope, SEEDED_TESTSET),
            args: (scope: StoryScope) => ({entity: {type: "testset", id: scope.id("ts-a")}}),
            reset: SAVE_RESET,
        },
    },
}

/** New-entity flow: no entity, "Create New" title, no save-as-new option. */
export const NewEntity: Story = {
    args: {
        open: true,
        defaultEntityType: "testset",
        initialName: "My new testset",
        onClose: () => {},
    },
    parameters: {
        agenta: {reset: SAVE_RESET},
    },
}

/** The save-failed branch, seeded directly into `saveModalErrorAtom`. */
export const ErrorState: Story = {
    parameters: {
        agenta: {
            args: (scope: StoryScope) => ({entityId: scope.id("ts-a")}),
            reset: SAVE_RESET,
        },
    },
    render: (args) => (
        <WithSaveError
            entityId={(args as {entityId?: string}).entityId ?? "ts-error"}
            error={new Error("A testset with this name already exists.")}
        >
            <EntitySaveModal />
        </WithSaveError>
    ),
}
