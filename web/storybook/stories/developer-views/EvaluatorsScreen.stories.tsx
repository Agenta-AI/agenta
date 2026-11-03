import {setUserAtoms} from "@agenta/entities/shared/user"
import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {LoadError} from "@agenta/ui/components/presentational"
import type {ListTableGroup} from "@agenta/ui/list-table"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {atom} from "jotai"
import {expect, userEvent, within} from "storybook/test"

import {ArchiveEvaluatorsDialog} from "../../../mobile/src/features/evaluators/ArchiveEvaluatorsDialog"
import {EvaluatorsTable} from "../../../mobile/src/features/evaluators/EvaluatorsTable"
import type {EvaluatorRevisionRow} from "../../../mobile/src/features/evaluators/evaluatorsView"
import {EvaluatorsEmpty} from "../../../mobile/src/features/evaluators/states/EvaluatorsEmpty"

// The evaluators page body: the table, its dialogs and its states. The page shell (nav, tabs,
// search) belongs to the mobile app and is not drawn here. A phone width shows the phone layout.

const ME = {id: "user-me", username: "Alex", email: "me@example.com"}
setUserAtoms({
    currentUserAtom: atom(ME),
    membersAtom: atom([
        {user: ME},
        {user: {id: "user-sam", username: "Sam Lee", email: "sam@example.com"}},
    ]),
})

const row = (
    workflowId: string,
    name: string,
    version: number,
    overrides: Partial<EvaluatorRevisionRow> = {},
): EvaluatorRevisionRow => ({
    id: `${workflowId}-r${version}`,
    workflowId,
    name,
    slug: `${workflowId}-slug`,
    version,
    createdAt: "2026-09-12T09:30:00Z",
    updatedAt: `2026-10-0${version}T14:05:00Z`,
    updatedById: version % 2 ? ME.id : "user-sam",
    message: version > 1 ? `Tighten the match on whitespace (${version})` : "First version",
    evaluatorKey: "auto_exact_match",
    feedbackKeys: [],
    ...overrides,
})

const AUTOMATIC: ListTableGroup<EvaluatorRevisionRow>[] = [
    {
        key: "w1",
        label: "Exact match check v3",
        rows: [
            row("w1", "Exact match check", 3),
            row("w1", "Exact match check", 2),
            row("w1", "Exact match check", 1),
        ],
    },
    {
        key: "w2",
        label: "Contains keyword v1",
        rows: [row("w2", "Contains keyword", 1, {evaluatorKey: "auto_contains_any"})],
    },
    {
        key: "w3",
        label: "Judge with a long name that has to truncate in a narrow column v2",
        rows: [
            row("w3", "Judge with a long name that has to truncate in a narrow column", 2, {
                evaluatorKey: "auto_ai_critique",
            }),
        ],
    },
]

const HUMAN: ListTableGroup<EvaluatorRevisionRow>[] = [
    {
        key: "h1",
        label: "Answer quality v2",
        rows: [
            row("h1", "Answer quality", 2, {
                evaluatorKey: "feedback",
                feedbackKeys: ["rating", "notes", "tone", "accuracy"],
            }),
            row("h1", "Answer quality", 1, {evaluatorKey: "feedback", feedbackKeys: ["rating"]}),
        ],
    },
]

const meta = {
    title: "@agenta/mobile/Developer/Evaluators/EvaluatorsScreen",
    component: EvaluatorsTable,
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
        groups: AUTOMATIC,
        category: "automatic" as EvaluatorCategory,
        selectable: true,
        selectedWorkflowIds: new Set<string>(),
        isLoading: false,
        empty: <EvaluatorsEmpty category="automatic" />,
        onToggle: () => undefined,
        onOpen: () => undefined,
        onArchive: () => undefined,
    },
} satisfies Meta<typeof EvaluatorsTable>

export default meta
type Story = StoryObj<typeof meta>

export const Automatic: Story = {
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        const [menu] = await canvas.findAllByRole("button", {name: "Evaluator actions"})
        await userEvent.click(menu)
        const body = within(canvasElement.ownerDocument.body)
        await expect(await body.findByRole("menuitem", {name: "Configure"})).toBeVisible()
        await expect(await body.findByRole("menuitem", {name: "Archive"})).toBeVisible()
    },
}

export const Human: Story = {
    args: {groups: HUMAN, category: "human", empty: <EvaluatorsEmpty category="human" />},
}

export const Loading: Story = {args: {isLoading: true}}

export const Empty: Story = {args: {groups: []}}

export const NoMatch: Story = {
    args: {
        groups: [],
        empty: <EvaluatorsEmpty category="automatic" term="rubric" onClear={() => undefined} />,
    },
}

/** A row ticked: the page toolbar then shows Archive in place of Archived. */
export const Selected: Story = {args: {selectedWorkflowIds: new Set(["w1", "w3"])}}

/** A viewer without `edit_evaluators` can read the list but has no checkboxes and no Archive. */
export const ReadOnly: Story = {args: {selectable: false}}

export const ArchiveConfirm: Story = {
    render: () => (
        <ArchiveEvaluatorsDialog
            targets={[{name: "Exact match check", version: 3}]}
            inUseRunCount={null}
            pending={false}
            onConfirm={() => undefined}
            onClose={() => undefined}
        />
    ),
}

export const ArchiveMany: Story = {
    render: () => (
        <ArchiveEvaluatorsDialog
            targets={[
                {name: "Exact match check", version: 3},
                {name: "Contains keyword", version: 1},
                {name: "Answer quality", version: 2},
                {name: "Length check", version: 1},
                {name: "Tone check", version: 4},
            ]}
            inUseRunCount={null}
            pending={false}
            onConfirm={() => undefined}
            onClose={() => undefined}
        />
    ),
}

/** Evaluation runs still use the evaluator, so nothing is archived. */
export const InUse: Story = {
    render: () => (
        <ArchiveEvaluatorsDialog
            targets={[{name: "Exact match check", version: 3}]}
            inUseRunCount={3}
            pending={false}
            onConfirm={() => undefined}
            onClose={() => undefined}
        />
    ),
}

/** The page replaces the table with this when the load fails. */
export const LoadFailed: Story = {
    render: () => <LoadError framed title="Could not load evaluators" onRetry={() => undefined} />,
}
