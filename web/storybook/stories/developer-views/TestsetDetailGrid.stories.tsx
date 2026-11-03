import {useState, type ReactNode} from "react"

import {testcaseMolecule, type TestcaseDataConfig} from "@agenta/entities/testcase"
import {clearChangesAtom} from "@agenta/entities/testset"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore} from "jotai"
import {expect, fn, userEvent, within} from "storybook/test"

import {TestsetDetailSkeleton} from "../../../mobile/src/features/testsets/detail/states/TestsetDetailSkeleton"
import {TestcaseEditorDrawer} from "../../../mobile/src/features/testsets/detail/TestcaseEditorDrawer"
import {TestsetGrid} from "../../../mobile/src/features/testsets/detail/TestsetGrid"
import type {ColumnEdit} from "../../../mobile/src/features/testsets/detail/useTestsetEditor"

/**
 * The grid and the drawer of the Test set detail page, over local rows in the shared store.
 * The editor actions are stubs: a column change reports a saved version and changes nothing.
 */
const meta = {
    title: "@agenta/mobile/Developer/Testsets/Detail grid",
    component: TestsetGrid,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The testcase grid of a test set page: row menu, column menus, bulk delete and the add column step. A reader who may not edit gets the rows only; while a save runs every change is off.",
            },
        },
    },
} satisfies Meta<typeof TestsetGrid>

export default meta
type Story = StoryObj<typeof meta>

const ROWS = [
    {question: "What is the refund window?", answer: "30 days", meta: {lang: "en", tone: "calm"}},
    {question: "Do you ship abroad?", answer: "Yes, to 40 countries", meta: {lang: "en"}},
    {
        question: "Can I return a used item?",
        answer: "Only when it is faulty",
        meta: {lang: "fr", tone: "firm"},
    },
]

const store = getDefaultStore()

/** Puts the rows in the shared store as unsaved rows, once per story render. */
const Seeded = ({rows, children}: {rows: Record<string, unknown>[]; children: ReactNode}) => {
    const [ready] = useState(() => {
        store.set(clearChangesAtom)
        for (const data of rows) store.set(testcaseMolecule.actions.add, {data})
        return true
    })
    return ready ? children : null
}

const config: TestcaseDataConfig = {scopeId: "story-testset-grid", useLocal: true}
const saved = async (): Promise<ColumnEdit> => ({ok: true, revisionId: null})

const editor = {
    isNew: true,
    tableConfig: config,
    readOnly: false,
    columnEditBlocked: null,
    deleteRows: fn(),
    addColumn: saved,
    renameColumn: saved,
    deleteColumns: saved,
}

const args = {editor, canEdit: true, onOpenRow: fn(), onColumnSaved: fn()}

export const GridFilled: Story = {
    args,
    render: (props) => (
        <Seeded rows={ROWS}>
            <TestsetGrid {...props} />
        </Seeded>
    ),
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByText("What is the refund window?")).toBeInTheDocument()
        await expect(canvas.getByRole("button", {name: "Add column"})).toBeEnabled()
    },
}

export const GridNoRows: Story = {
    args,
    render: (props) => (
        <Seeded rows={[]}>
            <TestsetGrid {...props} />
        </Seeded>
    ),
}

export const GridReadOnly: Story = {
    args: {...args, canEdit: false},
    render: GridFilled.render,
}

export const GridSaving: Story = {
    args: {
        ...args,
        editor: {
            ...editor,
            readOnly: true,
            columnEditBlocked: "Wait for the current save to finish",
        },
    },
    render: GridFilled.render,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByRole("button", {name: "Add column"})).toBeDisabled()
    },
}

export const AddColumnStep: Story = {
    args,
    render: GridFilled.render,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: "Add column"}))
        const dialog = within(document.body)
        await expect(await dialog.findByText("Add Column")).toBeInTheDocument()
    },
}

export const Skeleton: Story = {args, render: () => <TestsetDetailSkeleton />}

/** The drawer on an unsaved row, with its note. */
const DrawerOnFirstRow = ({viewOnly}: {viewOnly: boolean}) => {
    const [id] = useState(() => {
        store.set(clearChangesAtom)
        return store.set(testcaseMolecule.actions.add, {data: ROWS[0]})?.id ?? null
    })
    return (
        <TestcaseEditorDrawer
            testcaseId={id}
            testcaseNumber={1}
            columns={[
                {key: "question", label: "question"},
                {key: "answer", label: "answer"},
            ]}
            viewOnly={viewOnly}
            hasPrevious={false}
            hasNext
            onPrevious={fn()}
            onNext={fn()}
            onClose={fn()}
            onOpenCommit={fn()}
        />
    )
}

export const DrawerNewRow: Story = {args, render: () => <DrawerOnFirstRow viewOnly={false} />}
export const DrawerViewOnly: Story = {args, render: () => <DrawerOnFirstRow viewOnly />}
