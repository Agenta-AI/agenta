import {useState} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {buildResultKey, resultsByKeyAtomFamily} from "@agenta/playground/state"
import {FocusDrawer} from "@agenta/playground-ui/panels/focus"
import {openPlaygroundFocusDrawerAtom} from "@agenta/playground-ui/state"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore} from "jotai"
import {userEvent, within} from "storybook/test"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {workflowIds} from "../../fixtures/workflow"

import {promptRevisionQueries, selectRevision} from "./playgroundFixtures"

/**
 * The focus drawer of one test case in the /m prompt playground: the inputs as a form, JSON or
 * YAML, previous and next to move through the rows, and the row's output under the form.
 */
type Outcome = "none" | "running" | "result" | "error" | "repeats"

const reply = (text: string) => ({response: {data: text}})

const seedOutcome = (row: string, entityId: string, outcome: Outcome) => {
    if (outcome === "none") return
    const store = getDefaultStore()
    const loadableId = store.get(playgroundController.selectors.loadableId()) as string
    const result =
        outcome === "running"
            ? {status: "running"}
            : outcome === "error"
              ? {status: "error", error: {message: "The model did not answer in time."}}
              : outcome === "repeats"
                ? {
                      status: "success",
                      output: reply("Paris"),
                      repetitions: [{output: reply("Paris")}, {output: reply("Lutetia")}],
                  }
                : {status: "success", output: reply("Paris")}
    store.set(resultsByKeyAtomFamily(loadableId), {
        [buildResultKey(row, `sess:${entityId}`)]: result as never,
    })
}

const Demo = ({
    revisionId,
    outcome = "result",
    rows = 3,
    startAt = 1,
}: {
    revisionId: string
    outcome?: Outcome
    rows?: number
    /** 0-based row the drawer opens on. */
    startAt?: number
}) => {
    useState(() => {
        selectRevision(revisionId)
        const store = getDefaultStore()
        for (let i = 1; i < rows; i++) store.set(executionItemController.actions.addRow)
        const ids = store.get(executionItemController.selectors.generationRowIds) as string[]
        const countries = ["France", "Italy", "Spain"]
        ids.forEach((id, index) =>
            store.set(executionItemController.actions.setTestcaseCellValue, {
                testcaseId: id,
                column: "country",
                value: countries[index % countries.length],
            }),
        )
        seedOutcome(ids[startAt], revisionId, outcome)
        store.set(openPlaygroundFocusDrawerAtom, {rowId: ids[startAt], entityId: revisionId})
    })
    return <FocusDrawer />
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/FocusDrawer",
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
    await within(canvasElement.ownerDocument.body).findByText("Testcase 2")
}

export const Form: Story = {
    args: {revisionId: "", outcome: "result"},
    play: async ({canvasElement}) => ready(canvasElement),
}

/** The JSON view shows the inputs, the columns the row lacks and the outputs; only the inputs are written back. */
export const Json: Story = {
    args: {revisionId: "", outcome: "result"},
    play: async ({canvasElement}) => {
        await ready(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(await body.findByText("Form"))
        await userEvent.click(await body.findByText("JSON"))
    },
}

export const NoResult: Story = {
    args: {revisionId: "", outcome: "none"},
    play: async ({canvasElement}) => ready(canvasElement),
}

export const Running: Story = {
    args: {revisionId: "", outcome: "running"},
    play: async ({canvasElement}) => ready(canvasElement),
}

export const Result: Story = {
    args: {revisionId: "", outcome: "result"},
    play: async ({canvasElement}) => ready(canvasElement),
}

export const ErrorResult: Story = {
    args: {revisionId: "", outcome: "error"},
    play: async ({canvasElement}) => ready(canvasElement),
}

export const Repeats: Story = {
    args: {revisionId: "", outcome: "repeats"},
    play: async ({canvasElement}) => ready(canvasElement),
}

/** On a phone the drawer takes the full width. */
export const Phone: Story = {
    args: {revisionId: "", outcome: "result"},
    parameters: {viewport: {defaultViewport: "mobile1"}},
    play: async ({canvasElement}) => ready(canvasElement),
}
