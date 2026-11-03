import {testcaseMolecule} from "@agenta/entities/testcase"
import {LoadTestsetDialog} from "@agenta/playground-ui/panels/testsets"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore} from "jotai"
import {fn, userEvent, within} from "storybook/test"

import {withAppBoxSizing} from "./borderBox"
import {CAPITAL_ROWS, CAPITALS, CAPITALS_V2, withTestsetApi} from "./testsetApiStub"

/**
 * The load dialog of the /m playground test set menu: the test sets on the left (first step on a
 * phone), the rows of the picked revision on the right, search, and the footer count.
 */
const meta = {
    title: "@agenta/mobile/Developer/Playground/LoadTestsetDialog",
    component: LoadTestsetDialog,
    decorators: [withTestsetApi, withAppBoxSizing],
    parameters: {layout: "fullscreen", agenta: {queries: []}},
    args: {
        loadableId: "testset:workflow:story",
        mode: "load",
        connectedRevisionId: null,
        connectedTestsetId: null,
        singleSelect: false,
        onConfirm: fn(),
        onCancel: fn(),
    },
} satisfies Meta<typeof LoadTestsetDialog>

export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

/** Opens the Capitals test set: on a phone this is the step to its rows. */
const openCapitals = async (canvasElement: HTMLElement) => {
    await userEvent.click(await body(canvasElement).findByTitle("Capitals"))
    await body(canvasElement).findByText("Paris")
}

const tick = async (canvasElement: HTMLElement, value: string) => {
    const cell = await body(canvasElement).findByText(value)
    const row = cell.closest("[role='row'], tr") as HTMLElement
    await userEvent.click(within(row).getByRole("checkbox"))
}

/** The test set list before a pick. On a wide screen the newest test set opens by itself. */
export const List: Story = {
    play: async ({canvasElement}) => {
        await body(canvasElement).findByTitle("Rivers")
    },
}

/** The rows of the picked revision. */
export const Preview: Story = {
    play: async ({canvasElement}) => openCapitals(canvasElement),
}

/** Two rows ticked: the footer counts them against the revision's rows. */
export const RowPick: Story = {
    play: async ({canvasElement}) => {
        await openCapitals(canvasElement)
        await tick(canvasElement, "Paris")
        await tick(canvasElement, "Lima")
    },
}

/** The search keeps the rows with a matching value. */
export const Search: Story = {
    play: async ({canvasElement}) => {
        await openCapitals(canvasElement)
        await userEvent.type(body(canvasElement).getByLabelText("Search test cases"), "ro")
    },
}

/** A chat playground picks one row: radio buttons instead of checkboxes. */
export const SingleSelect: Story = {
    args: {singleSelect: true},
    play: async ({canvasElement}) => openCapitals(canvasElement),
}

/** "Manage test cases": the connected revision with the shown rows already picked. */
export const EditMode: Story = {
    args: {mode: "edit", connectedRevisionId: CAPITALS_V2, connectedTestsetId: CAPITALS},
    render: (args) => {
        getDefaultStore().set(
            testcaseMolecule.actions.initSelectionDraft,
            CAPITALS_V2,
            CAPITAL_ROWS.slice(0, 2).map((row) => row.id),
        )
        return <LoadTestsetDialog {...args} />
    },
    play: async ({canvasElement}) => {
        await body(canvasElement).findByText("Paris")
    },
}

/** With `onCreate` the sets column starts with "Create a new test set". */
export const WithCreate: Story = {
    args: {onCreate: fn()},
    play: async ({canvasElement}) => {
        await body(canvasElement).findByRole("button", {name: "Create a new test set"})
    },
}
