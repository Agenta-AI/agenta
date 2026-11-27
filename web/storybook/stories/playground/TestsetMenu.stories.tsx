import {useT} from "@agenta/i18n"
import testsetsCatalog from "@agenta/i18n/catalogs/playground.testsets"
import type {TestsetMenuModel} from "@agenta/playground-ui/hooks"
import {TestsetMenu} from "@agenta/playground-ui/panels/runs"
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
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

// The keep-drafts question as the /m playground draws it, with "Capitals" as the test set.
const KeepDraftsRender = ({draftCount, chat}: {draftCount: number; chat: boolean}) => {
    const t = useT(testsetsCatalog)
    const name = "Capitals"
    const many = draftCount > 1
    return (
        <AlertDialog open onOpenChange={(next) => (next ? undefined : keep.onCancel())}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {chat
                            ? t("playground.testsets.replaceConversationTitle")
                            : t("playground.testsets.keepDraftsTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="flex flex-col gap-2">
                            {chat ? (
                                <>
                                    <p className="m-0">
                                        {t("playground.testsets.loadingReplaces", {name})}
                                    </p>
                                    <p className="m-0">{t("playground.testsets.chatOneAtATime")}</p>
                                </>
                            ) : (
                                <>
                                    <p className="m-0">
                                        {many
                                            ? t("playground.testsets.draftsMany", {
                                                  count: draftCount,
                                              })
                                            : t("playground.testsets.draftsOne")}
                                    </p>
                                    <p className="m-0">
                                        {many
                                            ? t("playground.testsets.keepThemAndLoad", {name})
                                            : t("playground.testsets.keepItAndLoad", {name})}
                                    </p>
                                </>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={keep.onCancel}>
                            {t("playground.testsets.cancel")}
                        </Button>
                    </AlertDialogCancel>
                    <Button variant="destructive" onClick={keep.onDiscard}>
                        {chat
                            ? t("playground.testsets.loadAndReplace")
                            : t("playground.testsets.discardDrafts")}
                    </Button>
                    {chat ? null : (
                        <Button onClick={keep.onKeep}>
                            {t("playground.testsets.keepAndLoad")}
                        </Button>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export const KeepOne: Story = {
    render: () => <KeepDraftsRender draftCount={1} chat={false} />,
}

export const KeepMany: Story = {
    render: () => <KeepDraftsRender draftCount={3} chat={false} />,
}

export const Chat: Story = {
    render: () => <KeepDraftsRender draftCount={1} chat />,
}

const unsaved = {onSave: fn(), onDiscard: fn(), onCancel: fn()}

const UNSAVED_COPY = {
    disconnect: {
        title: "playground.testsets.disconnectTitle",
        question: "playground.testsets.disconnectQuestion",
        note: "playground.testsets.disconnectNote",
        discard: "playground.testsets.disconnectDiscard",
        save: "playground.testsets.disconnectSave",
    },
    change: {
        title: "playground.testsets.changeTitle",
        question: "playground.testsets.changeQuestion",
        note: "playground.testsets.changeNote",
        discard: "playground.testsets.changeDiscard",
        save: "playground.testsets.changeSave",
    },
} as const

// The unsaved-edits question as the /m playground draws it.
const UnsavedRender = ({intent, saving}: {intent: "disconnect" | "change"; saving: boolean}) => {
    const t = useT(testsetsCatalog)
    const copy = UNSAVED_COPY[intent]
    return (
        <AlertDialog
            open
            onOpenChange={(next) => {
                if (!next && !saving) unsaved.onCancel()
            }}
        >
            <AlertDialogContent
                onEscapeKeyDown={(event) => {
                    if (saving) event.preventDefault()
                }}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="flex flex-col gap-2">
                            <p className="m-0">{t(copy.question)}</p>
                            <p className="m-0">{t(copy.note)}</p>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={unsaved.onCancel} disabled={saving}>
                            {t("playground.testsets.cancel")}
                        </Button>
                    </AlertDialogCancel>
                    <Button variant="destructive" onClick={unsaved.onDiscard} disabled={saving}>
                        {t(copy.discard)}
                    </Button>
                    <Button onClick={unsaved.onSave} disabled={saving}>
                        {t(copy.save)}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export const UnsavedDisconnect: Story = {
    render: () => <UnsavedRender intent="disconnect" saving={false} />,
}

export const UnsavedChange: Story = {
    render: () => <UnsavedRender intent="change" saving={false} />,
}

export const Saving: Story = {
    render: () => <UnsavedRender intent="disconnect" saving />,
}
