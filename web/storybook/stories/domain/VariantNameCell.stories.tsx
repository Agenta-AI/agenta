import {VariantNameCell} from "@agenta/entity-ui/variant"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {variantNameCellQueries, workflowIds, workflowRevision} from "../../fixtures/workflow"

/**
 * **Data-connected story spike.** `VariantNameCell` is the shape we want everywhere:
 * a thin container that reads atoms and hands a flat props bag to a pure sibling
 * (`VariantDetailsWithStatus`, which has zero jotai/entities imports).
 *
 * It reads 5 atoms across 3 molecules — workflow detail, the variants list, the latest
 * revision id, environment deployments, and local draft dirtiness — so it exercises the
 * whole chain: gate atoms → QueryClient cache → `atomWithQuery` → molecule `serverData`
 * → merged `data`. No product code is mocked; the story only seeds the two injection
 * points the app itself uses.
 *
 * Every id is story-scoped (`scope.id(…)`), so no two stories address the same
 * `atomFamily` entry and draft state cannot leak between them.
 *
 * `isDirty` needs no fixture: it is local draft state that correctly defaults to false.
 */
const meta = {
    title: "@agenta/entity-ui/Domain/VariantNameCell",
    component: VariantNameCell,
    parameters: {
        docs: {
            description: {
                component:
                    "Variant name + version + deployment status cell. Data-connected: " +
                    "renders from the workflow/environment molecules given a revision id.",
            },
        },
        agenta: {
            queries: (scope: StoryScope) => variantNameCellQueries(scope),
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
} satisfies Meta<typeof VariantNameCell>

export default meta
type Story = StoryObj<typeof meta>

/** Reads the story's own scoped revision id — see `parameters.agenta.args`. */
const scopedRevisionArgs = (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId})

/** Latest revision, no deployments — the common table-cell case. */
export const Default: Story = {}

/** Deployed to two environments, with the status badges shown. */
export const Deployed: Story = {
    args: {showBadges: true},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                variantNameCellQueries(scope, {deployedTo: ["production", "staging"]}),
            args: scopedRevisionArgs,
        },
    },
}

/** An older revision — `isLatest` false, so the "Latest" tag is suppressed. */
export const NotLatest: Story = {
    args: {showBadges: true},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => variantNameCellQueries(scope, {isLatest: false}),
            args: scopedRevisionArgs,
        },
    },
}

/** A revision whose variant carries a name distinct from the workflow's. */
export const NamedVariant: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                variantNameCellQueries(scope, {
                    variantNames: ["Experimental"],
                    revision: (ids) => workflowRevision(ids, {version: 12}),
                }),
            args: scopedRevisionArgs,
        },
    },
}

/**
 * No fixture at all. The revision query resolves to nothing, so the component takes its
 * `!workflowData` branch and renders the "No deployment" fallback — the empty state a
 * data-connected story can otherwise never reach.
 */
export const NoData: Story = {
    args: {revisionId: "rev-does-not-exist"},
    parameters: {agenta: {queries: []}},
}
