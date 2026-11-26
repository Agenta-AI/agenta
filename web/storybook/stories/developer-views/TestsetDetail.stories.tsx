import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, fn, userEvent, within} from "storybook/test"

import {
    AddColumnButton,
    ColumnDialog,
    type ColumnDialogStep,
} from "../../../mobile/src/features/testsets/detail/ColumnDialogs"
import {CommitTestsetDialog} from "../../../mobile/src/features/testsets/detail/CommitTestsetDialog"
import {LeavePrompt} from "../../../mobile/src/features/testsets/detail/LeavePrompt"
import {
    TestsetHeader,
    type TestsetHeaderProps,
} from "../../../mobile/src/features/testsets/detail/TestsetHeader"
import type {RevisionsList} from "../../../mobile/src/features/testsets/detail/useRevisionsList"

/**
 * The parts of the Test set detail page that hold no data layer: the header, the commit step and
 * the prompt for leaving with unsaved changes. Each story passes what the page would pass.
 */
const meta = {
    title: "@agenta/mobile/Developer/Testsets/Detail",
    component: TestsetHeader,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The test set page header: name, version menu, copy control, actions menu and description. Verbs a reader may not use are left out. The commit step shows the next version, the row counts and an optional preview of the change.",
            },
        },
    },
} satisfies Meta<typeof TestsetHeader>

export default meta
type Story = StoryObj<typeof meta>

const REVISIONS: RevisionsList["revisions"] = [
    {
        id: "rev-3",
        version: 3,
        createdAt: "2026-03-04T10:00:00Z",
        message: "Added cases for partial refunds",
        authorId: null,
    },
    {
        id: "rev-2",
        version: 2,
        createdAt: "2026-02-10T10:00:00Z",
        message: "Fixed two wrong answers",
        authorId: null,
    },
    {id: "rev-1", version: 1, createdAt: "2026-01-20T10:00:00Z", message: null, authorId: null},
]

const base: TestsetHeaderProps = {
    header: {
        testsetId: "set-1",
        testsetName: "Refund questions",
        testsetSlug: "refund-questions",
        description: "Questions customers ask when they want their money back.",
        revisionSlug: "refund-questions-v3",
        revisionVersion: 3,
        commitMessage: "Added cases for partial refunds",
        author: undefined,
        createdAt: "2026-03-04T10:00:00Z",
        updatedAt: "2026-03-04T10:00:00Z",
    },
    revisionId: "rev-3",
    isNew: false,
    canEdit: true,
    canExport: true,
    revisions: {revisions: REVISIONS, status: "ready", load: fn()},
    onPickRevision: fn(),
    onSaveDetails: async () => true,
    savingDetails: false,
    exporting: null,
    onExport: fn(),
    archiveDisabledReason: null,
    onArchive: fn(),
}

export const HeaderFilled: Story = {
    args: base,
    play: async ({canvasElement, args}) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole("button", {name: "Choose a version"}))
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(await body.findByRole("menuitem", {name: /v2/}))
        await expect(args.onPickRevision).toHaveBeenCalledWith("rev-2")
    },
}

export const HeaderNewTestset: Story = {
    args: {
        ...base,
        isNew: true,
        revisionId: null,
        header: {
            ...base.header!,
            testsetName: "Greeting checks",
            description: undefined,
            revisionVersion: undefined,
        },
    },
}

export const HeaderReadOnly: Story = {args: {...base, canEdit: false, canExport: false}}

const noop = () => undefined

const dialogArgs = {
    open: true,
    isNew: false,
    currentVersion: 3,
    latestVersion: 3,
    summary: {updatedTestcases: 2, newTestcases: 1, deletedTestcases: 0},
    diff: null,
    pending: false,
    onClose: noop,
    onCommit: noop,
}

export const CommitDialog: Story = {
    args: base,
    render: () => <CommitTestsetDialog {...dialogArgs} />,
}

export const CommitDialogWithDiff: Story = {
    args: base,
    render: () => (
        <CommitTestsetDialog
            {...dialogArgs}
            diff={{
                count: 2,
                original: {rows: {"case-1": {question: "Can I get a refund?", answer: "Yes"}}},
                modified: {
                    rows: {
                        "case-1": {question: "Can I get a refund?", answer: "Yes, within 30 days"},
                        "new row 1": {question: "Is shipping refunded?", answer: "No"},
                    },
                },
            }}
        />
    ),
}

const LeavePromptStory = ({isNew}: {isNew: boolean}) => {
    const [open, setOpen] = useState(true)
    return (
        <LeavePrompt
            open={open}
            isNew={isNew}
            onSave={() => setOpen(false)}
            onCancel={() => setOpen(false)}
            onLeave={() => setOpen(false)}
        />
    )
}

export const LeavePromptSaved: Story = {
    args: base,
    render: () => <LeavePromptStory isNew={false} />,
}

export const LeavePromptNew: Story = {
    args: base,
    render: () => <LeavePromptStory isNew />,
}

const ColumnDialogStory = ({
    step,
    savesVersion,
}: {
    step: ColumnDialogStep
    savesVersion: boolean
}) => {
    const [open, setOpen] = useState(true)
    return (
        <ColumnDialog
            step={open ? step : null}
            savesVersion={savesVersion}
            onClose={() => setOpen(false)}
            onSubmit={async (name) =>
                name === "question"
                    ? {ok: false, reason: "duplicate"}
                    : {ok: true, revisionId: null}
            }
            onDone={() => setOpen(false)}
        />
    )
}

export const ColumnAddSaved: Story = {
    args: base,
    render: () => <ColumnDialogStory step={{kind: "add"}} savesVersion />,
}

export const ColumnRenameSaved: Story = {
    args: base,
    render: () => <ColumnDialogStory step={{kind: "rename", columnKey: "answer"}} savesVersion />,
}

export const ColumnDeleteSaved: Story = {
    args: base,
    render: () => (
        <ColumnDialogStory
            step={{kind: "delete", columnKey: "answer", columnKeys: ["answer"], isGroup: false}}
            savesVersion
        />
    ),
}

export const ColumnRenameNewTestset: Story = {
    args: base,
    render: () => (
        <ColumnDialogStory step={{kind: "rename", columnKey: "answer"}} savesVersion={false} />
    ),
}

export const ColumnActionsBlocked: Story = {
    args: base,
    render: () => (
        <AddColumnButton blockedReason="Save or discard your row changes first" onClick={noop} />
    ),
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByRole("button", {name: "Add column"})).toBeDisabled()
        await userEvent.hover(
            canvas.getByRole("button", {name: "Add column"}).parentElement ?? canvasElement,
        )
    },
}
