import {Sheet, SheetContent} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {LiveEvaluationForm} from "../../../mobile/src/features/evaluations/live/LiveEvaluationForm"
import {SHEET_FRAME} from "../../../mobile/src/features/evaluations/new/sheetFrame"
import type {QueryFixtures, StoryScope} from "../../.storybook/decorators/withAgentaData"

/**
 * The live evaluation form from web/mobile, in the sheet frame the runs list opens. The evaluator
 * select reads the evaluator list and each evaluator's latest revision from the story's query
 * cache. The loading and load error states are covered by the unit tests.
 */

const noop = () => undefined
const create = async () => "failed" as const

interface EvaluatorFixture {
    name: string
    key: string
    flags?: Record<string, boolean>
}

const TONE: EvaluatorFixture = {name: "Tone check", key: "auto_regex_test"}
const JUDGE: EvaluatorFixture = {
    name: "Helpfulness judge",
    key: "auto_ai_critique",
    flags: {is_llm: true},
}
const EXACT: EvaluatorFixture = {name: "Exact answer", key: "auto_exact_match"}

const queries =
    (evaluators: EvaluatorFixture[]) =>
    (scope: StoryScope): QueryFixtures => [
        [
            ["workflows", "evaluators", "list", scope.projectId],
            {
                count: evaluators.length,
                refs: evaluators.map((evaluator) => ({
                    id: scope.id(evaluator.key),
                    name: evaluator.name,
                    slug: evaluator.key,
                    flags: {is_evaluator: true},
                })),
            },
        ],
        ...evaluators.map((evaluator): QueryFixtures[number] => [
            ["workflows", "latestRevision", scope.id(evaluator.key), scope.projectId],
            {
                id: scope.id(`${evaluator.key}-revision`),
                workflow_id: scope.id(evaluator.key),
                name: evaluator.name,
                version: 2,
                flags: {is_evaluator: true, ...evaluator.flags},
                data: {
                    uri: `agenta:builtin:${evaluator.key}:v0`,
                    schemas: {
                        outputs: {
                            type: "object",
                            properties: {success: {type: "boolean"}, score: {type: "number"}},
                        },
                    },
                },
            },
        ]),
        [
            ["evaluatorTemplates", scope.projectId],
            {
                count: 2,
                templates: [
                    {key: "auto_regex_test", name: "Regex Test", categories: ["classifiers"]},
                    {key: "auto_ai_critique", name: "LLM-as-a-judge", categories: ["ai_llm"]},
                ],
            },
        ],
    ]

type FormProps = React.ComponentProps<typeof LiveEvaluationForm>

const SheetFrame = (props: FormProps) => (
    <Sheet open modal={false}>
        <SheetContent {...SHEET_FRAME}>
            <LiveEvaluationForm {...props} />
        </SheetContent>
    </Sheet>
)

const filled = (scope: StoryScope) => ({
    initial: {
        name: "Tone check-k3x9",
        description: "Replies from the help desk",
        samplingRate: 25,
        evaluatorRevisionId: scope.id("auto_regex_test-revision"),
        userFilters: [
            {field: "attributes", key: "ag.meta.user", operator: "is" as const, value: "Sam Lee"},
            {field: "status", operator: "is" as const, value: "error"},
        ],
    },
})

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/LiveEvaluationSheet",
    component: SheetFrame,
    parameters: {
        layout: "fullscreen",
        agenta: {queries: queries([TONE, JUDGE, EXACT])},
        docs: {
            description: {
                component:
                    "The live evaluation form from web/mobile, drawn without a page behind it.",
            },
        },
    },
    args: {
        evaluatorsHref: "/evaluators",
        isCreating: false,
        create,
        onClose: noop,
        onCreated: noop,
    },
} satisfies Meta<typeof SheetFrame>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("Live evaluation")).toBeVisible()
        await expect(screen.getByText("No filters • Sampling 100% • Live traffic")).toBeVisible()
        // The filter dialog opens with the invocation row locked at the top.
        await userEvent.click(screen.getByRole("button", {name: "Filter"}))
        await expect(await screen.findByText("Apply")).toBeVisible()
        await userEvent.click(screen.getByText("Cancel", {selector: "button *, button"}))
    },
}

export const Filled: Story = {
    parameters: {agenta: {queries: queries([TONE, JUDGE, EXACT]), args: filled}},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(
            await screen.findByText("2 filters • Sampling 25% • Live traffic"),
        ).toBeVisible()
        await expect(await screen.findByText("Output metrics")).toBeVisible()
    },
}

export const ValidationErrors: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await userEvent.click(await screen.findByRole("button", {name: "Create live evaluation"}))
        await expect(await screen.findByText("Enter a name")).toBeVisible()
        await expect(screen.getByText("Select an evaluator")).toBeVisible()
    },
}

export const NoSupportedEvaluators: Story = {
    parameters: {agenta: {queries: queries([EXACT])}},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText(/No supported evaluators are available/)).toBeVisible()
        await expect(screen.getByRole("button", {name: "Create live evaluation"})).toBeDisabled()
    },
}

export const Creating: Story = {
    parameters: {agenta: {queries: queries([TONE, JUDGE, EXACT]), args: filled}},
    args: {isCreating: true},
}

export const Phone: Story = {
    parameters: {agenta: {queries: queries([TONE, JUDGE, EXACT]), args: filled}},
    globals: {viewport: {value: "mobile1", isRotated: false}},
}
