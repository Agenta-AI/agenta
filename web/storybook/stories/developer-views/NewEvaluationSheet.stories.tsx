import {Sheet, SheetContent} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, within} from "storybook/test"

import type {
    DraftEvaluator,
    NewEvaluationDraft,
} from "../../../mobile/src/features/evaluations/new/newEvaluationDraft"
import {NewEvaluationForm} from "../../../mobile/src/features/evaluations/new/NewEvaluationForm"
import {SHEET_FRAME} from "../../../mobile/src/features/evaluations/new/sheetFrame"
import type {QueryFixtures, StoryScope} from "../../.storybook/decorators/withAgentaData"

/**
 * The new evaluation wizard from web/mobile, in the sheet frame the runs list opens. The sections
 * read the app and evaluator lists from the story's query cache. The pickers open on data the
 * stories do not seed, so the picks arrive through `initial`.
 */

const APPS = {
    support: "Support bot",
    search: "Search assistant",
}

const noop = () => undefined
const start = async () => ({status: "failed"}) as const

const queries =
    (evaluatorCount: number) =>
    (scope: StoryScope): QueryFixtures => [
        [
            ["workflows", "apps", "list", scope.projectId],
            {
                count: 2,
                refs: [
                    {
                        id: scope.id("support"),
                        name: APPS.support,
                        slug: "support",
                        flags: {is_chat: true},
                    },
                    {id: scope.id("search"), name: APPS.search, slug: "search", flags: {}},
                ],
            },
        ],
        [
            ["workflows", "evaluators", "list", scope.projectId],
            {
                count: evaluatorCount,
                refs: Array.from({length: evaluatorCount}, (_, index) => ({
                    id: scope.id(`evaluator-${index}`),
                    name: `Evaluator ${index + 1}`,
                    slug: `evaluator-${index + 1}`,
                    flags: {is_evaluator: true},
                })),
            },
        ],
    ]

const EVALUATORS: DraftEvaluator[] = [
    {
        revisionId: "revision-exact-2",
        evaluatorId: "evaluator-exact",
        name: "Exact match",
        version: 2,
    },
    {
        revisionId: "revision-tone-1",
        evaluatorId: "evaluator-tone",
        name: "Tone check",
        version: 1,
    },
]

const FILLED: Partial<NewEvaluationDraft> = {
    app: {id: "app-support", name: APPS.support, isCustom: false},
    revisions: [
        {id: "revision-a", variantName: "default", version: 3},
        {id: "revision-b", variantName: "concise", version: 1},
    ],
    testset: {revisionId: "testset-revision", testsetId: "testset", name: "greetings", version: 2},
    evaluators: EVALUATORS,
    name: "2-variants-greetings-k3x9a",
    autoName: "2-variants-greetings-k3x9a",
    section: "evaluators",
}

type FormProps = React.ComponentProps<typeof NewEvaluationForm>

const SheetFrame = (props: FormProps) => (
    <Sheet open modal={false}>
        <SheetContent {...SHEET_FRAME}>
            <NewEvaluationForm {...props} />
        </SheetContent>
    </Sheet>
)

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/NewEvaluationSheet",
    component: SheetFrame,
    parameters: {
        layout: "fullscreen",
        agenta: {queries: queries(2)},
        docs: {
            description: {
                component:
                    "The new evaluation wizard from web/mobile, drawn without a page behind it.",
            },
        },
    },
    args: {
        kind: "auto",
        appId: null,
        evaluatorsHref: "/evaluators",
        isStarting: false,
        start,
        onClose: noop,
        onStarted: noop,
    },
} satisfies Meta<typeof SheetFrame>

export default meta
type Story = StoryObj<typeof meta>

export const AutoEmpty: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("New Auto Evaluation")).toBeVisible()
        await expect(
            screen.getByText(
                "Please select an application to continue configuring the evaluation.",
            ),
        ).toBeVisible()
    },
}

export const AutoFilled: Story = {
    args: {initial: FILLED},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("default - v3")).toBeVisible()
        await expect(screen.getByDisplayValue("2-variants-greetings-k3x9a")).toBeVisible()
    },
}

export const HumanFilled: Story = {
    args: {
        kind: "human",
        initial: {
            ...FILLED,
            revisions: [{id: "revision-a", variantName: "default", version: 3}],
            name: "default-v3-greetings-k3x9a",
            autoName: "default-v3-greetings-k3x9a",
        },
    },
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("New Human Evaluation")).toBeVisible()
    },
}

export const AppScoped: Story = {
    args: {appId: "app-support", initial: {...FILLED, section: "revision"}},
}

export const NoEvaluators: Story = {
    parameters: {agenta: {queries: queries(0)}},
    args: {
        initial: {
            app: FILLED.app,
            revisions: FILLED.revisions,
            testset: FILLED.testset,
            section: "evaluators",
        },
    },
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("No evaluators yet")).toBeVisible()
    },
}

export const ValidationError: Story = {
    args: {
        initial: {
            ...FILLED,
            concurrency: {batch_size: null, max_retries: 3, retry_delay: 3},
            section: "settings",
        },
    },
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("This field is required")).toBeVisible()
    },
}

export const Starting: Story = {
    args: {isStarting: true, initial: FILLED},
}

export const Phone: Story = {
    args: {initial: FILLED},
    globals: {viewport: {value: "mobile1", isRotated: false}},
}
