import {useState} from "react"

import {buildAttributeKeyTreeOptions, getFilterColumns, type Filter} from "@agenta/observability"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {AnnotatedTracesFilter} from "../../../mobile/src/features/observability/filters/AnnotatedTracesFilter"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

const evaluator = (slug: string, name: string, properties: Record<string, unknown>) => ({
    ref: {id: `wf-${slug}`, slug, name},
    revision: {
        id: `rev-${slug}`,
        workflow_id: `wf-${slug}`,
        slug,
        name,
        flags: {is_evaluator: true, is_feedback: true},
        data: {schemas: {outputs: {type: "object", properties}}},
    },
})

const EVALUATORS = [
    evaluator("quality", "Quality", {
        rating: {type: "integer", title: "Rating"},
        comment: {type: "string"},
    }),
    evaluator("tone", "Tone", {friendly: {type: "boolean", title: "Friendly"}}),
]

/** The evaluator list and each evaluator's latest revision, the two reads the row makes. */
const fixtures = (evaluators: typeof EVALUATORS) => (scope: StoryScope) => [
    [
        ["workflows", "evaluators", "list", scope.projectId],
        {count: evaluators.length, refs: evaluators.map((item) => item.ref)},
    ] as [unknown[], unknown],
    ...evaluators.map(
        (item) =>
            [["workflows", "latestRevision", item.ref.id, scope.projectId], item.revision] as [
                unknown[],
                unknown,
            ],
    ),
]

const COLUMNS = getFilterColumns(buildAttributeKeyTreeOptions([]))

const Controlled = ({initial}: {initial: Filter[]}) => {
    const [filters, setFilters] = useState<Filter[]>(initial)
    return (
        <AnnotatedTracesFilter
            filterData={filters}
            columns={COLUMNS}
            onApplyFilter={setFilters}
            onClearFilter={setFilters}
        />
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Observability/AnnotatedTracesFilter",
    component: Controlled,
    parameters: {
        layout: "padded",
        agenta: {queries: fixtures(EVALUATORS)},
        docs: {
            description: {
                component:
                    "The traces filter dialog with the evaluator and feedback controls on its annotation row. The controls and the evaluator list load when a dialog with an annotation row first opens.\n\n**Used in:** the /m Observability toolbar and the Live evaluation filter, behind the `observability-actions` developer view.",
            },
        },
    },
    args: {initial: []},
} satisfies Meta<typeof Controlled>

export default meta
type Story = StoryObj<typeof meta>

const openDialog = async ({canvasElement}: {canvasElement: HTMLElement}) => {
    await userEvent.click(within(canvasElement).getByRole("button", {name: "Filter"}))
}

const ANNOTATION_ROW: Filter = {
    field: "has_annotation",
    operator: "in",
    value: [{evaluator: "quality", feedback: {field: "rating", operator: "gt", value: 3}}],
} as Filter

export const Closed: Story = {}

export const OpenEmpty: Story = {play: openDialog}

export const AnnotationRow: Story = {
    args: {initial: [ANNOTATION_ROW]},
    play: async (context) => {
        await openDialog(context)
        const body = within(context.canvasElement.ownerDocument.body)
        await expect(await body.findByRole("combobox", {name: "Evaluator"})).toBeVisible()
        await expect(await body.findByText("Quality")).toBeVisible()
    },
}

export const NoEvaluators: Story = {
    args: {
        initial: [
            {field: "has_annotation", operator: "in", value: [{evaluator: undefined}]} as Filter,
        ],
    },
    parameters: {agenta: {queries: fixtures([])}},
    play: async (context) => {
        await openDialog(context)
        const body = within(context.canvasElement.ownerDocument.body)
        await userEvent.click(await body.findByRole("combobox", {name: "Evaluator"}))
    },
}
