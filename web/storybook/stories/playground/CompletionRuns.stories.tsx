import {useState} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {RunsPanel} from "@agenta/playground-ui/panels/runs"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore} from "jotai"
import {within} from "storybook/test"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {workflowIds} from "../../fixtures/workflow"

import {promptRevisionQueries, selectRevision} from "./playgroundFixtures"

/**
 * The /m prompt playground's run pane for a completion app: the header bar (Generations,
 * Clear, Run all) and one row for each test case, with its inputs and its output.
 * Data-connected: the revision comes from the seeded query cache.
 */
const Demo = ({
    revisionId,
    rows = 1,
    collapsed = false,
    connected = false,
}: {
    revisionId: string
    rows?: number
    collapsed?: boolean
    /** Connects the playground to a test set, then edits the second row and adds a third. */
    connected?: boolean
}) => {
    useState(() => {
        selectRevision(revisionId)
        const store = getDefaultStore()
        if (connected) {
            store.set(playgroundController.actions.connectToTestset, {
                loadableId: store.get(playgroundController.selectors.loadableId()) as string,
                revisionId: "story-testset-revision",
                testcases: [
                    {id: "tc-1", country: "France"},
                    {id: "tc-2", country: "Italy"},
                ],
                testsetName: "Capitals",
                testsetId: "story-testset",
                revisionVersion: 2,
            })
            store.set(executionItemController.actions.setTestcaseCellValue, {
                testcaseId: "tc-2",
                column: "country",
                value: "Spain",
            })
            store.set(executionItemController.actions.addRow)
        }
        for (let i = 1; i < rows; i++) store.set(executionItemController.actions.addRow)
        store.set(executionItemController.selectors.allRowsCollapsed, collapsed)
    })
    return (
        <div className="h-[640px] w-full max-w-[720px] overflow-y-auto border border-border bg-background text-foreground">
            <RunsPanel revisionId={revisionId} />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/CompletionRuns",
    component: Demo,
    parameters: {
        layout: "fullscreen",
        agenta: {
            queries: (scope: StoryScope) => promptRevisionQueries(scope),
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

const ready = async (canvasElement: HTMLElement) => {
    await within(canvasElement).findByText("test case 1")
}

/** One empty test case, before any run. */
export const OneRow: Story = {
    args: {revisionId: ""},
    play: async ({canvasElement}) => ready(canvasElement),
}

export const ThreeRows: Story = {
    args: {revisionId: "", rows: 3},
    play: async ({canvasElement}) => ready(canvasElement),
}

/** "Generations" folds every row to its label and run control. */
export const Collapsed: Story = {
    args: {revisionId: "", rows: 3, collapsed: true},
    play: async ({canvasElement}) => ready(canvasElement),
}

/** Connected to a test set: one unchanged row, one "Edited" row and one "New" row. */
export const ConnectedRows: Story = {
    args: {revisionId: "", connected: true},
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText("Edited")
    },
}

/** At 390px the header and the row controls wrap inside the pane. */
export const Phone: Story = {
    args: {revisionId: "", rows: 2},
    parameters: {viewport: {defaultViewport: "mobile1"}},
    play: async ({canvasElement}) => ready(canvasElement),
}
