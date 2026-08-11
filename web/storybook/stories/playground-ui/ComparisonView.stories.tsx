import type {ReactNode} from "react"

import {playgroundNodesAtom} from "@agenta/playground/state"
import {
    GenerationComparisonChatOutput,
    GenerationComparisonCompletionOutput,
    GenerationComparisonOutput,
    GenerationComparisonOutputHeader,
} from "@agenta/playground-ui/comparison-view"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    REVISION_A_ID,
    REVISION_B_ID,
    REVISION_DRAFT_ID,
    REVISION_NO_VARIANT_ID,
    comparisonQueries,
    twoVariantNodes,
} from "./_fixtures/comparisonView"

/**
 * The comparison-view output side: the column header, the top-level composite that switches
 * chat vs completion, and the two per-mode renderers.
 *
 * ## Why these are not antd-vs-agenta parity rows
 *
 * The migration is already merged and verified; nothing here reconstructs pre-migration antd
 * markup. Every story is a data-seam showcase.
 *
 * ## The row/turn graph boundary
 *
 * `GenerationComparisonChatOutput` and the chat branch of `GenerationComparisonOutput` read
 * `executionItemController.selectors.itemsByRow(rowId)`, which resolves through
 * `renderableExecutionItemsAtom` → `executionRowIdsAtom` (= `generationRowIdsAtom`, sourced from
 * `derivedLoadableIdAtom` → the testcase molecule's `displayRowIds`) and `displayedEntityIdsAtom`
 * (sourced from the playground's selected-entities state). Both trace back to the seeded
 * execution-row graph another wave-3 agent is building a helper for. Without it, `itemsByRow`
 * is always `[]`, so `GenerationComparisonChatOutput` renders `<div className="flex" />` — an
 * empty, non-crashing DOM node — no matter what props it is given. See `ChatOutput` below: it
 * is documented as an empty-render, not faked with reconstructed row data.
 *
 * `GenerationComparisonCompletionOutput` sidesteps this: it takes `rowId`/`entityId` directly
 * as props and reads only entity-scoped selectors
 * (`workflowMolecule.selectors.data/configuration/isDirty`, `useExecutionCell`'s
 * `resolvedGenerationResultAtomFamily`, which itself degrades to a clean `idle` result when
 * `derivedLoadableIdAtom` is unset). So it renders for real — see `CompletionOutput` below.
 *
 * ## `playgroundNodesAtom` is a shared singleton
 *
 * `@agenta/playground/state`'s `playgroundNodesAtom` is a bare `atom([])`, not an
 * `atomFamily` — it is one of the L2 residue singletons `withAgentaData.tsx` warns about.
 * Every story here that seeds it also resets it in `parameters.agenta.reset` so a previous
 * story (in this file or another) cannot leak nodes into it.
 */
const meta = {
    title: "@agenta/playground-ui/Comparison/View",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Comparison output header, the mode-switching composite, chat and completion outputs.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const Case = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex flex-col gap-2 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-start gap-3">{children}</div>
    </div>
)

/**
 * The 44px column header: variant label + version badge above each comparison column.
 *
 * `variantLabel` resolves through `["workflows", "variants", workflowId, projectId]`, and
 * that query's outer selector (`workflowVariantsQueryAtomFamily`) short-circuits to
 * `data: undefined` before even touching the cache when `sessionAtom` is closed — so, unlike
 * most of wave 3, this story needs `session: true`, not the usual `session: false`.
 */
export const OutputHeader: Story = {
    parameters: {
        agenta: {
            session: true,
            queries: (scope: {projectId: string}) => comparisonQueries(scope.projectId),
        },
    },
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Case label="resolved variant label (GPT-4o) + version badge">
                <div className="w-[420px]">
                    <GenerationComparisonOutputHeader entityId={REVISION_A_ID} />
                </div>
            </Case>
            <Case label="second column — a different variant of the same workflow (GPT-4o mini)">
                <div className="w-[420px]">
                    <GenerationComparisonOutputHeader entityId={REVISION_B_ID} />
                </div>
            </Case>
            <Case label="no workflow_variant_id on the revision — falls back to data?.name ('default'), a real defect: see final report">
                <div className="w-[420px]">
                    <GenerationComparisonOutputHeader entityId={REVISION_NO_VARIANT_ID} />
                </div>
            </Case>
            <Case label="local draft id — badge reads 'Draft', name falls back to data?.name">
                <div className="w-[420px]">
                    <GenerationComparisonOutputHeader entityId={REVISION_DRAFT_ID} />
                </div>
            </Case>
        </div>
    ),
}

/**
 * The mode-switching composite. `isChatMode` derives from the playground's node graph
 * (`playgroundCapabilityModeAtom` needs a depth-0 node) — with no nodes seeded it is
 * `undefined`, and the component's own guard (`isChatVariant === undefined ? null : ...`)
 * renders nothing. That is correct, documented behaviour, not a fixture gap: production only
 * reaches this component after the playground has resolved a root node.
 *
 * Chat- and completion-mode both additionally require `itemsByRow(rowId)` — the row/turn graph
 * boundary described in the file docblock — so even seeding a node here would still render
 * nothing. Covered directly instead: `ChatOutput` and `CompletionOutput` below.
 */
export const Output: Story = {
    parameters: {agenta: {session: false, queries: [], reset: [[playgroundNodesAtom, []]]}},
    render: () => (
        <Case label="isChatMode undefined (no playground node graph) — renders null, correctly">
            <div className="min-h-[40px] w-[420px] rounded border border-dashed border-colorBorderSecondary p-2 text-xs text-colorTextSecondary">
                <GenerationComparisonOutput rowId="row-1" isFirstRow />
                (nothing renders inside this dashed box — that is the assertion)
            </div>
        </Case>
    ),
}

/**
 * `itemsByRow(turnId)` is always `[]` without the seeded execution-row graph (file docblock),
 * so this renders an empty `<div className="flex" />` for every prop combination — a real,
 * unavoidable empty state for this wave, not a bug and not faked. Keeping the story documents
 * the boundary rather than silently dropping the export.
 */
export const ChatOutput: Story = {
    parameters: {agenta: {session: false, queries: []}},
    render: () => (
        <Case label="no row/turn graph seeded — renders nothing, by current limitation (see docblock)">
            <div className="min-h-[40px] w-[420px] rounded border border-dashed border-colorBorderSecondary p-2 text-xs text-colorTextSecondary">
                <GenerationComparisonChatOutput turnId="turn-1" isFirstRow />
                (nothing renders inside this dashed box — that is the assertion)
            </div>
        </Case>
    ),
}

/**
 * Renders for real: `rowId`/`entityId` are explicit props, so the row/turn-graph boundary above
 * does not apply. `variantIndex === 0` additionally mounts `CompletionMode` (the sticky input
 * column) inside its own `!w-[400px]` box; that column depends on `isComparisonView`
 * (`playground/selectedEntities.length > 1`, itself derived from `playgroundNodesAtom`) and a
 * per-entity row list, so with two depth-0 nodes seeded but no execution rows it renders an
 * empty (but correctly framed) box — the primary NodeResultCard on the right is unaffected and
 * always renders.
 */
export const CompletionOutput: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: {projectId: string}) => comparisonQueries(scope.projectId),
            atoms: [[playgroundNodesAtom, twoVariantNodes]],
            reset: [[playgroundNodesAtom, []]],
        },
    },
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Case label="variantIndex 0 — idle result, input column present but empty (no execution rows seeded)">
                <div className="flex">
                    <GenerationComparisonCompletionOutput
                        rowId="row-1"
                        entityId={REVISION_A_ID}
                        variantIndex={0}
                    />
                </div>
            </Case>
            <Case label="variantIndex 1 — second column, no input box, idle result">
                <div className="flex">
                    <GenerationComparisonCompletionOutput
                        rowId="row-1"
                        entityId={REVISION_B_ID}
                        variantIndex={1}
                    />
                </div>
            </Case>
        </div>
    ),
}
