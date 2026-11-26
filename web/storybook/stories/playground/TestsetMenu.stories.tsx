import type {TestsetMenuModel} from "@agenta/playground-ui/hooks"
import {TestsetMenu} from "@agenta/playground-ui/panels/runs"
import {KeepDraftRowsDialog, UnsavedTestsetDialog} from "@agenta/playground-ui/panels/testsets"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {fn, userEvent, within} from "storybook/test"

import {withAppBoxSizing} from "./borderBox"
import {testsetMenuModel} from "./testsetMenuModel"

/**
 * The test set menu of the /m playground run pane and its two questions: keep the draft test
 * cases when a test set loads, and save the test set edits before leaving the test set.
 */
const Bar = ({menu}: {menu: TestsetMenuModel}) => (
    <div className="flex justify-end bg-background p-4 text-foreground">
        <TestsetMenu model={menu} />
    </div>
)

const meta = {
    title: "@agenta/mobile/Developer/Playground/TestsetMenu",
    component: Bar,
    decorators: [withAppBoxSizing],
    parameters: {layout: "fullscreen"},
    args: {menu: testsetMenuModel()},
} satisfies Meta<typeof Bar>

export default meta
type Story = StoryObj<typeof meta>

const open = async (canvasElement: HTMLElement) => {
    await userEvent.click(within(canvasElement).getByRole("button"))
    await within(canvasElement.ownerDocument.body).findAllByRole("menuitem")
}

export const Local: Story = {play: async ({canvasElement}) => open(canvasElement)}

export const Connected: Story = {
    args: {menu: testsetMenuModel({isConnected: true, label: "Capitals (v2)"})},
    play: async ({canvasElement}) => open(canvasElement),
}

export const ConnectedWithEdits: Story = {
    args: {
        menu: testsetMenuModel({isConnected: true, hasLocalChanges: true, label: "Capitals (v2)"}),
    },
    play: async ({canvasElement}) => open(canvasElement),
}

const keep = {onKeep: fn(), onDiscard: fn(), onCancel: fn()}

export const KeepOne: Story = {
    render: () => (
        <KeepDraftRowsDialog draftCount={1} testsetName="Capitals" chat={false} {...keep} />
    ),
}

export const KeepMany: Story = {
    render: () => (
        <KeepDraftRowsDialog draftCount={3} testsetName="Capitals" chat={false} {...keep} />
    ),
}

export const Chat: Story = {
    render: () => <KeepDraftRowsDialog draftCount={1} testsetName="Capitals" chat {...keep} />,
}

const unsaved = {onSave: fn(), onDiscard: fn(), onCancel: fn()}

export const UnsavedDisconnect: Story = {
    render: () => <UnsavedTestsetDialog intent="disconnect" saving={false} {...unsaved} />,
}

export const UnsavedChange: Story = {
    render: () => <UnsavedTestsetDialog intent="change" saving={false} {...unsaved} />,
}

export const Saving: Story = {
    render: () => <UnsavedTestsetDialog intent="disconnect" saving {...unsaved} />,
}
