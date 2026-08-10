import {
    EntitySelectorModal,
    entitySelectorConfigAtom,
    entitySelectorOpenAtom,
    resetEntitySelectorAtom,
    workflowRevisionAdapter,
    type EntitySelectorConfig,
} from "@agenta/entity-ui/selection"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {entityPickerQueries} from "../../fixtures/entityPicker"

/**
 * **Data-connected modal story.** EntitySelectorModal is atom-driven end to end: open
 * state, title, and the adapter tabs all come from `entitySelectorConfigAtom` /
 * `entitySelectorOpenAtom` (live, the promise-based `openEntitySelectorAtom` sets them).
 * The story seeds those two atoms directly — internal atom control, no external props —
 * plus the workflow adapter's query fixtures so the embedded breadcrumb picker lists
 * real seeded workflows.
 *
 * The modal singletons are rewound through `resetEntitySelectorAtom` before the story
 * renders (L2 reset), then re-opened by the `atoms` seeds (reset runs first).
 *
 * Only one entity type is configured, so the modal renders the picker without a tab bar.
 * A multi-tab story would need a second adapter with a distinct `entityType`; the only
 * other registered adapter (testset) cannot be seeded via the data seam (its root list
 * query sets `refetchOnMount: "always"` — see `fixtures/entityPicker.ts`), so it is
 * skipped rather than faked.
 */
const meta = {
    title: "@agenta/entity-ui/Selection/EntitySelectorModal",
    component: EntitySelectorModal,
    // The modal portals to <body>; rendering every story at once on a docs page would
    // stack the dialogs, so the autodocs page is disabled.
    tags: ["!autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Modal wrapper around the breadcrumb EntityPicker (already antd-free — " +
                    "inventory coverage). Open state and adapters are seeded through its own " +
                    "controller atoms.",
            },
        },
    },
} satisfies Meta<typeof EntitySelectorModal>

export default meta
type Story = StoryObj<typeof meta>

/** Rewinds the selector singletons before the `atoms` seeds below re-open the modal. */
const SELECTOR_RESET: [typeof resetEntitySelectorAtom, null][] = [[resetEntitySelectorAtom, null]]

const SELECTOR_CONFIG: EntitySelectorConfig = {
    title: "Select a workflow revision",
    allowedTypes: ["workflowRevision"],
    adapters: [workflowRevisionAdapter],
}

/** Default open, single entity type: breadcrumb picker over the seeded workflow list. */
export const Open: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => entityPickerQueries(scope),
            reset: SELECTOR_RESET,
            atoms: [
                [entitySelectorConfigAtom, SELECTOR_CONFIG],
                [entitySelectorOpenAtom, true],
            ],
        },
    },
}
