import {Sheet, SheetContent} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, within} from "storybook/test"

import type {
    DraftEvaluator,
    NewEvaluationDraft,
} from "../../../mobile/src/features/evaluations/new/newEvaluationDraft"
import {NewEvaluationForm} from "../../../mobile/src/features/evaluations/new/NewEvaluationForm"
import {WIDE_SHEET_FRAME} from "../../../mobile/src/features/evaluations/new/sheetFrame"
import type {QueryFixtures, StoryScope} from "../../.storybook/decorators/withAgentaData"

/**
 * The new evaluation wizard from web/mobile, in the sheet frame the runs list opens: the step
 * list on the left and the open step's table on the right. The step tables read the apps, the
 * revisions, the test sets and the evaluators from the story's query cache. The picks arrive
 * through `initial`.
 */

const APPS = {
    support: "Support bot",
    search: "Search assistant",
}

const noop = () => undefined
const start = async () => ({status: "failed"}) as const

const CREATED = "2026-11-05T19:32:00Z"
const AUTHOR = {created_at: CREATED, created_by_id: "user-alex"}

const appRevision = (id: string, variant: string, version: number, message: string) => ({
    revisionId: id,
    workflowId: "app-support",
    variantId: `variant-${variant}`,
    variantName: variant,
    variantSlug: variant,
    version,
    model: "gpt-4o-mini",
    message,
    createdAt: CREATED,
    createdById: "user-alex",
})

const evaluatorEntry = (
    id: string,
    name: string,
    revision: Record<string, unknown>,
): {workflow: Record<string, unknown>; latestRevision: Record<string, unknown>} => ({
    workflow: {id, name, slug: id, flags: {is_evaluator: true}},
    latestRevision: {id: `${id}-revision`, workflow_id: id, version: 1, ...AUTHOR, ...revision},
})

const AUTOMATIC = [
    evaluatorEntry("evaluator-exact", "Exact match", {
        data: {uri: "agenta:builtin:auto_exact_match:v0"},
        message: "Compare with the expected answer",
    }),
]
const HUMAN = [
    evaluatorEntry("evaluator-helpful", "Helpfulness", {
        flags: {is_feedback: true},
        data: {
            uri: "agenta:custom:feedback:v0",
            schemas: {
                outputs: {
                    type: "object",
                    properties: {score: {type: "number"}, comment: {type: "string"}},
                },
            },
        },
    }),
]
const TESTSETS = [
    {id: "testset", name: "greetings", ...AUTHOR},
    {id: "testset-faq", name: "faq questions", ...AUTHOR},
]

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
                        created_at: CREATED,
                    },
                    {
                        id: scope.id("search"),
                        name: APPS.search,
                        slug: "search",
                        flags: {},
                        created_at: CREATED,
                    },
                ],
            },
        ],
        [
            ["workflows", "app-revisions", scope.projectId, "app-support", ""],
            {
                pages: [
                    {
                        rows: [
                            appRevision("revision-b", "concise", 1, "Shorter answers"),
                            appRevision("revision-a", "default", 3, "Tune the prompt"),
                            appRevision("revision-a2", "default", 2, "First prompt"),
                        ],
                        next: null,
                    },
                ],
                pageParams: [null],
            },
        ],
        [
            ["testsets", "list", scope.projectId, ""],
            {pages: [{testsets: TESTSETS, nextCursor: null}], pageParams: [null]},
        ],
        [
            ["testsets", "latest-revisions", scope.projectId, TESTSETS.map((t) => t.id)],
            new Map([
                ["testset", {id: "testset-revision", version: 2, message: "Add greetings"}],
                ["testset-faq", {id: "testset-faq-revision", version: 1, message: null}],
            ]),
        ],
        [
            ["workflows", "evaluators", "m", "active", scope.projectId, "automatic", ""],
            AUTOMATIC.slice(0, evaluatorCount),
        ],
        [
            ["workflows", "evaluators", "m", "active", scope.projectId, "human", ""],
            HUMAN.slice(0, evaluatorCount),
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
    app: {id: "app-support", name: APPS.support},
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
        <SheetContent {...WIDE_SHEET_FRAME}>
            <NewEvaluationForm {...props} />
        </SheetContent>
    </Sheet>
)

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/NewEvaluationSheet",
    component: SheetFrame,
    parameters: {
        layout: "fullscreen",
        agenta: {queries: queries(2), args: (scope: StoryScope) => ({projectId: scope.projectId})},
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
        projectId: "",
        start,
        onCancel: noop,
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
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        // The revision table: each variant's newest revision with its commit notes.
        await expect(await screen.findByText("Tune the prompt")).toBeVisible()
    },
}

export const TestsetStep: Story = {
    args: {initial: {...FILLED, testset: null, evaluators: [], section: "testset"}},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("faq questions")).toBeVisible()
        await expect(screen.getByText("Add greetings")).toBeVisible()
    },
}

export const HumanEvaluators: Story = {
    args: {
        kind: "human",
        initial: {
            ...FILLED,
            revisions: [{id: "revision-a", variantName: "default", version: 3}],
            evaluators: [],
            section: "evaluators",
        },
    },
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        // The Feedback column: the fields the human evaluator asks for.
        await expect(await screen.findByText("comment")).toBeVisible()
    },
}

export const NoEvaluators: Story = {
    parameters: {
        agenta: {queries: queries(0), args: (scope: StoryScope) => ({projectId: scope.projectId})},
    },
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
