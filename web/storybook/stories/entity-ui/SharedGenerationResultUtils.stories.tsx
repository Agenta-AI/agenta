import {SharedGenerationResultUtils} from "@agenta/entity-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {traceIds, traceRootSpan, traceSummaryQueries} from "../../fixtures/trace"

/**
 * SharedGenerationResultUtils — data-connected: given a trace id it reads
 * `traceDataSummaryAtomFamily` (backed by the `["trace-summary", projectId, traceId]`
 * query) and renders the open-trace button, a status tag, and the metrics display.
 *
 * Migration: antd `Button`(icon/loading) → `LoadingButton` (`outline`/`icon-sm`),
 * antd `Skeleton.Button` → `SkeletonBlock`, antd `Tooltip` → `@agenta/ui` Tooltip,
 * antd `Tag` → `Badge` (`success`/`error`/`default` severities).
 *
 * Every id is story-scoped (`scope.id(…)`); the fixture root span is built through
 * `traceSpanSchema`.
 */
const meta = {
    title: "@agenta/entity-ui/Shared/SharedGenerationResultUtils",
    component: SharedGenerationResultUtils,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Trace result utils row (open-trace action + status + metrics). Data-connected via the trace-summary query.",
            },
        },
        agenta: {
            queries: (scope: StoryScope) => traceSummaryQueries(scope),
            args: (scope: StoryScope) => ({traceId: traceIds(scope).traceId}),
        },
    },
} satisfies Meta<typeof SharedGenerationResultUtils>

export default meta
type Story = StoryObj<typeof meta>

const scopedTraceArgs = (scope: StoryScope) => ({traceId: traceIds(scope).traceId})

/** Successful run: outline icon button + Success tag + duration/tokens/cost metrics. */
export const Success: Story = {
    args: {onViewTrace: () => undefined},
}

/** Errored run: root span carries STATUS_CODE_ERROR → error severity tag. */
export const ErrorStatus: Story = {
    args: {onViewTrace: () => undefined},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                traceSummaryQueries(scope, {
                    rootSpan: (ids) => traceRootSpan(ids, {status_code: "STATUS_CODE_ERROR"}),
                }),
            args: scopedTraceArgs,
        },
    },
}

/** actionsOnly — just the open-trace button + status, no metrics row. */
export const ActionsOnly: Story = {
    args: {actionsOnly: true, onViewTrace: () => undefined},
}

/** No onViewTrace handler → the action button renders disabled. */
export const NoHandler: Story = {}

/**
 * Pending: `session: false` keeps the auth gate closed so the summary query never
 * resolves — the skeleton branch (LoadingButton + SkeletonBlocks) renders.
 */
export const Pending: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: [],
            args: scopedTraceArgs,
        },
    },
}
