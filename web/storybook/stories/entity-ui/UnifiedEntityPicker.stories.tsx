import {
    EntityPicker,
    createWorkflowRevisionAdapter,
    workflowRevisionAdapter,
} from "@agenta/entity-ui/selection"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {entityPickerQueries} from "../../fixtures/entityPicker"

/**
 * **Data-connected showcase.** EntityPicker is a single component with a `variant` prop;
 * every variant reads its hierarchy through an adapter whose levels are jotai list atoms
 * over the query cache. The stories seed the workflow adapter's queries (see
 * `fixtures/entityPicker.ts`) — the seeded hierarchy is Support Agent → Production →
 * v3/v2/v1, plus two more root workflows so the list variants show a real list.
 *
 * The testset adapter cannot be used here: its root list query sets
 * `refetchOnMount: "always"`, which refires the real fetch over seeded data and flips the
 * list to its error state in Storybook (documented in the fixture file).
 *
 * Selection navigation state is `atomFamily(instanceId)`-keyed, so every story passes a
 * scope-derived `instanceId` (the L1 isolation rule).
 */
const meta = {
    title: "@agenta/entity-ui/Selection/UnifiedEntityPicker",
    component: EntityPicker,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Unified entity selection component (already antd-free — inventory " +
                    "coverage, no parity pair). One export per display variant: " +
                    "`cascading`, `cascader`, `breadcrumb`, `list-popover`, `popover-cascader`.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

const noop = () => undefined

/**
 * 2-level Workflow → Revision adapter for the list-popover variant (which requires
 * exactly 2 levels). Same skip-variant factory call the evaluator playground header uses.
 */
const workflowTwoLevelAdapter = createWorkflowRevisionAdapter({
    skipVariantLevel: true,
    parentLabel: "Application",
})

const pickerArgs = (name: string) => (scope: StoryScope) => ({instanceId: scope.id(name)})

const instanceId = (args: unknown) => (args as {instanceId?: string}).instanceId

/**
 * Cascading selects — one dropdown per hierarchy level (Workflow → Variant → Revision).
 * Levels below the current selection are disabled until their parent is picked.
 */
export const Cascading: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => entityPickerQueries(scope),
            args: pickerArgs("cascading"),
        },
    },
    render: (args) => (
        <div className="w-[320px]" data-vrt-subject>
            <EntityPicker
                variant="cascading"
                adapter={workflowRevisionAdapter}
                instanceId={instanceId(args)}
                onSelect={noop}
                showLabels
                layout="vertical"
            />
        </div>
    ),
}

/**
 * Single compact cascader dropdown — all levels drill down inside one popup panel.
 * The trigger renders closed at rest; children load lazily per panel on open.
 */
export const Cascader: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => entityPickerQueries(scope),
            args: pickerArgs("cascader"),
        },
    },
    render: (args) => (
        <div className="w-[320px]" data-vrt-subject>
            <EntityPicker
                variant="cascader"
                adapter={workflowRevisionAdapter}
                instanceId={instanceId(args)}
                onSelect={noop}
                placeholder="Select a revision..."
                className="w-full"
            />
        </div>
    ),
}

/**
 * Breadcrumb navigation — one level at a time with a breadcrumb trail, search, and
 * drill-down list. This is the variant EntitySelectorModal embeds.
 */
export const Breadcrumb: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => entityPickerQueries(scope),
            args: pickerArgs("breadcrumb"),
        },
    },
    render: (args) => (
        <div className="w-[360px]" data-vrt-subject>
            <EntityPicker
                variant="breadcrumb"
                adapter={workflowRevisionAdapter}
                instanceId={instanceId(args)}
                onSelect={noop}
                showSearch
                showBreadcrumb
                showBackButton
                rootLabel="All Workflows"
                maxHeight={320}
            />
        </div>
    ),
}

/**
 * List with hover popovers — vertical parent list; hovering a row opens its revisions in
 * a side popover (2-level hierarchies only, hence the skip-variant adapter). The popover
 * itself is hover-only interaction; at rest the story shows the searchable parent list.
 */
export const ListPopover: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => entityPickerQueries(scope),
            args: pickerArgs("list-popover"),
        },
    },
    render: (args) => (
        <div className="w-[320px]" data-vrt-subject>
            <EntityPicker
                variant="list-popover"
                adapter={workflowTwoLevelAdapter}
                instanceId={instanceId(args)}
                onSelect={noop}
                maxHeight={320}
            />
        </div>
    ),
}

/**
 * Button-triggered popover cascader — the "+ Add" style trigger that opens side-by-side
 * root/child panels. The open panel state is internal (`useState`), so at rest the story
 * renders the closed trigger button; click it to browse the seeded hierarchy.
 */
export const PopoverCascader: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => entityPickerQueries(scope),
            args: pickerArgs("popover-cascader"),
        },
    },
    render: (args) => (
        <div className="flex items-center" data-vrt-subject>
            <EntityPicker
                variant="popover-cascader"
                adapter={workflowTwoLevelAdapter}
                instanceId={instanceId(args)}
                onSelect={noop}
                placeholder="Select workflow"
            />
        </div>
    ),
}
