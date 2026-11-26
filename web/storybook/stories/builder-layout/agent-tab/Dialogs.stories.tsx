import type {ComponentProps, ReactNode} from "react"

import {AutomationActionsMenu} from "@/features/automations/AutomationActionsMenu"
import {useT} from "@agenta/i18n"
import agentSecretsCatalog from "@agenta/i18n/catalogs/entityUi.agentSecrets"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import versionCatalog from "@agenta/i18n/catalogs/playground.versionHistory"
import viewStackCatalog from "@agenta/i18n/catalogs/ui.viewStack"
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
import {screen, userEvent, within} from "storybook/test"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    agentTabQueries,
    DELETED_AUTOMATION,
    REMOVED_INTEGRATION,
    REVERT,
} from "../../../fixtures/builderLayout/agent-tab"

const noop = () => undefined

/** A frame the size of the panel, so each dialog shows over what it guards. */
const Frame = ({children}: {children?: ReactNode}) => (
    <div data-testid="agent-panel" className="relative h-[480px] w-[440px]">
        {children}
    </div>
)

/** F06 f1: the generic dialog of the view stack, with the description an agent view gives. */
const UnsavedChanges = () => {
    const t = useT(configItemsCatalog, viewStackCatalog)
    return (
        <AlertDialog open>
            <AlertDialogContent data-testid="unsaved-changes-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("ui.viewStack.unsavedChanges")}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("entityUi.configItems.saveOrDiscardDraft")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="ghost" onClick={noop}>
                        {t("ui.viewStack.keepEditing")}
                    </Button>
                    <Button variant="outline" onClick={noop}>
                        {t("ui.viewStack.discard")}
                    </Button>
                    <Button onClick={noop}>{t("ui.viewStack.saveChanges")}</Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

/** F06 f2: remove an item from the agent (the integration row's bin, or the integration view). */
const RemoveFromAgent = () => {
    const t = useT(integrationViewsCatalog)
    return (
        <AlertDialog open>
            <AlertDialogContent data-testid="remove-from-agent-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("entityUi.integrationViews.removeTitle", {name: REMOVED_INTEGRATION})}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("entityUi.integrationViews.connectionStays")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="outline" onClick={noop}>
                        {t("entityUi.integrationViews.cancel")}
                    </Button>
                    <Button variant="destructive" onClick={noop}>
                        {t("entityUi.integrationViews.remove")}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

/** F06 f3: remove a secret attachment (the bin of a secret row). */
const RemoveSecret = () => {
    const t = useT(agentSecretsCatalog)
    return (
        <AlertDialog open>
            <AlertDialogContent data-testid="secret-remove-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("entityUi.agentSecrets.removeAttachmentTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("entityUi.agentSecrets.removeAttachmentBody")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="outline" onClick={noop}>
                        {t("entityUi.agentSecrets.cancel")}
                    </Button>
                    <Button variant="destructive" onClick={noop}>
                        {t("entityUi.agentSecrets.remove")}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

// The storybook package does not depend on @agenta/automation-ui; the type comes from the menu.
type Automation = ComponentProps<typeof AutomationActionsMenu>["automation"]

const AUTOMATION: Automation = {
    id: "automation-daily-summary",
    kind: "schedule",
    name: DELETED_AUTOMATION,
    description: "",
    agentId: null,
    isActive: true,
    cron: "0 9 * * *",
    eventKey: null,
    connectionId: null,
    updatedAt: null,
    raw: {id: "automation-daily-summary", name: DELETED_AUTOMATION} as Automation["raw"],
}

/** F06 f5: revert from the version history. */
const Revert = () => {
    const t = useT(versionCatalog)
    return (
        <AlertDialog open>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("playground.versionHistory.revertTitle", {
                            version: REVERT.selectedVersion,
                        })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("playground.versionHistory.revertDescription", {
                            next: REVERT.latestVersion + 1,
                            version: REVERT.selectedVersion,
                            latest: REVERT.latestVersion,
                        })}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t("playground.versionHistory.cancel")}</AlertDialogCancel>
                    <Button onClick={noop}>{t("playground.versionHistory.revert")}</Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

const meta = {
    title: "BuilderLayout/agent-tab/Dialogs",
    component: Frame,
    parameters: {
        layout: "padded",
        agenta: {queries: (scope: StoryScope) => agentTabQueries(scope)},
    },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

/** F06 f1: "You have unsaved changes", Keep editing, Discard, Save changes. */
export const UnsavedChangesDialogStory: Story = {
    name: "Unsaved changes",
    render: () => (
        <Frame>
            <UnsavedChanges />
        </Frame>
    ),
}

/** F06 f2: "Remove Zendesk from this agent?" */
export const RemoveFromAgentStory: Story = {
    name: "Remove from agent",
    render: () => (
        <Frame>
            <RemoveFromAgent />
        </Frame>
    ),
}

/** F06 f3: "Remove this secret attachment?", as the bin of a secret row opens it. */
export const RemoveSecretStory: Story = {
    name: "Remove secret",
    render: () => (
        <Frame>
            <RemoveSecret />
        </Frame>
    ),
    play: async () => {
        await screen.findByText("Remove this secret attachment?")
    },
}

/** F06 f4: "Delete this automation?", opened from the automation's menu. */
export const DeleteAutomationStory: Story = {
    name: "Delete automation",
    render: () => (
        <Frame>
            <AutomationActionsMenu automation={AUTOMATION} base="/w/w/p/p" />
        </Frame>
    ),
    play: async ({canvasElement}) => {
        const menu = await within(canvasElement).findByRole("button", {
            name: "Automation actions",
        })
        menu.focus()
        await userEvent.keyboard("{Enter}")
        await userEvent.click(await screen.findByRole("menuitem", {name: "Delete"}))
        await screen.findByText("Delete this automation?")
    },
}

/** F06 f5: "Revert to v3?" */
export const RevertStory: Story = {
    name: "Revert version",
    render: () => (
        <Frame>
            <Revert />
        </Frame>
    ),
}
