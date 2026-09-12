import {AgentPicker} from "@agenta/entity-ui/agent"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {agentPickerIds, agentPickerQueries} from "../../fixtures/agentPicker"

/**
 * **The one way to choose an agent.** Every surface that binds one — an automation, a composer,
 * a panel — opens this, so the search, the glyphs and the "New agent" affordance cannot drift.
 *
 * Data-connected: the picker reads `agentWorkflowsListQueryStateAtom`, which unions the apps
 * list with the agent-flags query. Both keys are seeded here (see `fixtures/agentPicker.ts`) —
 * nothing is mocked, and the flags key carries a version token derived from the apps list, so
 * the two have to agree or the second query refetches against nothing.
 *
 * The states worth looking at are the ones a click cannot reach: an empty project, a read-only
 * binding, and an agent with no description (the row says so rather than leaving a blank line
 * that reads as a description which failed to load).
 */
const meta = {
    title: "@agenta/entity-ui/Agent/AgentPicker",
    component: AgentPicker,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Searchable agent selector: a Popover (not a Select — a select's typeahead " +
                    "competes with the search field), two densities, an optional create row.",
            },
        },
        agentaData: {queries: agentPickerQueries},
    },
    args: {
        onChange: () => undefined,
    },
} satisfies Meta<typeof AgentPicker>

export default meta
type Story = StoryObj<typeof meta>

/** The automations screen's field: full width, description under each name. */
export const Relaxed: Story = {
    args: {
        density: "relaxed",
        searchPlaceholder: "Search agents by name or what they do",
    },
    parameters: {
        agentaData: {
            queries: agentPickerQueries,
            args: (scope) => ({value: agentPickerIds(scope).briefingId}),
        },
    },
}

/** A toolbar or composer: the name alone, on a pill that hugs it. */
export const CompactPill: Story = {
    args: {
        trigger: "pill",
        density: "compact",
    },
    parameters: {
        agentaData: {
            queries: agentPickerQueries,
            args: (scope) => ({value: agentPickerIds(scope).newsId}),
        },
    },
}

/** With the create row. It sits under a rule: making an agent is not choosing one. */
export const WithCreateRow: Story = {
    args: {
        trigger: "pill",
        density: "compact",
        onCreateAgent: () => undefined,
    },
}

/** Nothing bound yet — the trigger reads as a placeholder, not as a broken value. */
export const Unbound: Story = {
    args: {density: "relaxed"},
}

/** Read-only: the bound agent keeps its glyph and its name, and the panel never opens. */
export const ReadOnly: Story = {
    args: {disabled: true},
    parameters: {
        agentaData: {
            queries: agentPickerQueries,
            args: (scope) => ({value: agentPickerIds(scope).linearId}),
        },
    },
}

/** A project with no agents. The panel says so rather than opening on an empty box. */
export const NoAgents: Story = {
    args: {density: "relaxed"},
    parameters: {
        agentaData: {queries: (scope) => agentPickerQueries(scope, {empty: true})},
    },
}
