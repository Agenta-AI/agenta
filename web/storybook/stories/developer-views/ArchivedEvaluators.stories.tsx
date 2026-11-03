import {setUserAtoms} from "@agenta/entities/shared/user"
import {LoadError} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {atom} from "jotai"
import {expect, userEvent, within} from "storybook/test"

import {ArchivedEvaluatorsTable} from "../../../mobile/src/features/evaluators/ArchivedEvaluatorsTable"
import type {EvaluatorArchivedRow} from "../../../mobile/src/features/evaluators/evaluatorsView"
import {EvaluatorsEmpty} from "../../../mobile/src/features/evaluators/states/EvaluatorsEmpty"

// The archived evaluators page body: the table and its states. The page shell (nav, back arrow,
// tabs, search) belongs to the mobile app and is not drawn here.

const ME = {id: "user-me", username: "Alex", email: "me@example.com"}
setUserAtoms({
    currentUserAtom: atom(ME),
    membersAtom: atom([
        {user: ME},
        {user: {id: "user-sam", username: "Sam Lee", email: "sam@example.com"}},
    ]),
})

const archived = (
    id: string,
    name: string,
    archivedAt: string,
    archivedById: string | null,
    overrides: Partial<EvaluatorArchivedRow> = {},
): EvaluatorArchivedRow => ({
    id: `${id}-r2`,
    workflowId: id,
    name,
    slug: `${id}-slug`,
    version: 2,
    createdAt: "2026-08-12T09:30:00Z",
    updatedAt: "2026-09-02T09:30:00Z",
    updatedById: ME.id,
    message: null,
    evaluatorKey: "auto_exact_match",
    feedbackKeys: [],
    archivedAt,
    archivedById,
    ...overrides,
})

const ROWS: EvaluatorArchivedRow[] = [
    archived("a1", "Exact match check", "2026-10-28T14:05:00Z", ME.id),
    archived("a2", "Contains keyword", "2026-10-14T08:20:00Z", "user-sam", {
        evaluatorKey: "auto_contains_any",
    }),
    archived(
        "a3",
        "Judge with a long name that has to truncate in a narrow column",
        "2026-09-30T10:10:00Z",
        null,
        {evaluatorKey: "auto_ai_critique"},
    ),
]

const meta = {
    title: "@agenta/mobile/Developer/Evaluators/ArchivedEvaluators",
    component: ArchivedEvaluatorsTable,
    parameters: {layout: "padded"},
    // Storybook's Tailwind has no preflight, so boxes are content-box there; the app's is
    // border-box. Without this the rows come out wider than the header and drift.
    decorators: [
        (Story) => (
            <>
                <style>
                    {".evaluators-story, .evaluators-story * { box-sizing: border-box; }"}
                </style>
                <div className="evaluators-story">
                    <Story />
                </div>
            </>
        ),
    ],
    args: {
        rows: ROWS,
        category: "automatic",
        isLoading: false,
        restoring: false,
        empty: <EvaluatorsEmpty category="automatic" archived />,
        onOpen: () => undefined,
        onRestore: () => undefined,
    },
} satisfies Meta<typeof ArchivedEvaluatorsTable>

export default meta
type Story = StoryObj<typeof meta>

export const Filled: Story = {
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        const [menu] = await canvas.findAllByRole("button", {name: "Evaluator actions"})
        await userEvent.click(menu)
        const body = within(canvasElement.ownerDocument.body)
        await expect(await body.findByRole("menuitem", {name: "Open details"})).toBeVisible()
        await expect(await body.findByRole("menuitem", {name: "Restore"})).toBeVisible()
    },
}

export const Human: Story = {
    args: {
        category: "human",
        rows: [
            archived("h1", "Answer quality", "2026-10-20T10:00:00Z", ME.id, {
                evaluatorKey: "feedback",
                feedbackKeys: ["rating", "notes", "tone", "accuracy"],
            }),
        ],
    },
}

export const Loading: Story = {args: {isLoading: true}}

export const Empty: Story = {args: {rows: []}}

/** A viewer without `edit_evaluators` can open details but has no Restore. */
export const ReadOnly: Story = {args: {onRestore: undefined}}

/** The page replaces the table with this when the load fails. */
export const LoadFailed: Story = {
    render: () => (
        <LoadError framed title="Could not load archived evaluators" onRetry={() => undefined} />
    ),
}
