import {useState, type ComponentProps, type ReactNode} from "react"

import {AutomationActionsMenu} from "@/features/automations/AutomationActionsMenu"
import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {RevertConfirmDialog} from "@agenta/playground-ui/agent-version-history"
import {UnsavedChangesDialog} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {screen, userEvent, within} from "storybook/test"

// Imported from source: the package barrel does not re-export these two.
import {AgentSecretsSection} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentSecretsSection"
import {RemoveFromAgentDialog} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/RemoveFromAgentDialog"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    agentTabIds,
    agentTabQueries,
    DELETED_AUTOMATION,
    REMOVED_INTEGRATION,
    REVERT,
    type AgentTabIds,
} from "../../../fixtures/builderLayout/agent-tab"
import {SECRET_NAMES} from "../../../fixtures/builderLayout/index"

const noop = () => undefined

/** A frame the size of the panel, so each dialog shows over what it guards. */
const Frame = ({children}: {children: ReactNode}) => (
    <div data-testid="agent-panel" className="relative h-[480px] w-[440px]">
        {children}
    </div>
)

/** F06 f1: the generic dialog of the view stack, with the description an agent view gives. */
const UnsavedChanges = () => {
    const t = useT(configItemsCatalog)
    return (
        <UnsavedChangesDialog
            open
            description={t("entityUi.configItems.saveOrDiscardDraft")}
            canSave
            onAnswer={noop}
        />
    )
}

/** F06 f2: remove an item from the agent (the integration row's bin, or the integration view). */
const RemoveFromAgent = () => {
    const t = useT(integrationViewsCatalog)
    return (
        <RemoveFromAgentDialog
            open
            name={REMOVED_INTEGRATION}
            description={t("entityUi.integrationViews.connectionStays")}
            onRemove={noop}
            onClose={noop}
        />
    )
}

/** F06 f3: the Secrets list of the agent; the story clicks the bin of the first secret. */
const RemoveSecret = ({ids}: {ids: AgentTabIds}) => (
    <AgentSecretsSection
        revisionId={ids.revisionId}
        bindings={SECRET_NAMES.map((name) => ({
            secret: {slug: name.toLowerCase()},
            binding: {type: "env" as const, name},
        }))}
    />
)

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

/** F06 f4: the automation's menu; the story opens it and picks Delete. */
const DeleteAutomation = () => <AutomationActionsMenu automation={AUTOMATION} base="/w/w/p/p" />

/** F06 f5: revert from the version history; the dialog sits inside the history drawer. */
const Revert = () => {
    const [container, setContainer] = useState<HTMLDivElement | null>(null)
    return (
        <div ref={setContainer} className="relative h-full w-full">
            <RevertConfirmDialog
                open
                container={container}
                selectedVersion={REVERT.selectedVersion}
                latestVersion={REVERT.latestVersion}
                onCancel={noop}
                onConfirm={noop}
            />
        </div>
    )
}

type Dialog = "unsaved" | "remove" | "secret" | "automation" | "revert"

const Dialogs = ({dialog, ids}: {dialog: Dialog; ids: AgentTabIds}) => (
    <Frame>
        {dialog === "unsaved" ? <UnsavedChanges /> : null}
        {dialog === "remove" ? <RemoveFromAgent /> : null}
        {dialog === "secret" ? <RemoveSecret ids={ids} /> : null}
        {dialog === "automation" ? <DeleteAutomation /> : null}
        {dialog === "revert" ? <Revert /> : null}
    </Frame>
)

const meta = {
    title: "BuilderLayout/agent-tab/Dialogs",
    component: Dialogs,
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) => agentTabQueries(scope),
            args: (scope: StoryScope) => ({ids: agentTabIds(scope)}),
        },
    },
} satisfies Meta<typeof Dialogs>

export default meta
type Story = StoryObj<typeof meta>

const ids: AgentTabIds = {projectId: "", workflowId: "", revisionId: ""}

/** F06 f1: "You have unsaved changes", Keep editing, Discard, Save changes. */
export const UnsavedChangesDialogStory: Story = {
    name: "Unsaved changes",
    args: {dialog: "unsaved", ids},
}

/** F06 f2: "Remove Zendesk from this agent?" */
export const RemoveFromAgentStory: Story = {
    name: "Remove from agent",
    args: {dialog: "remove", ids},
}

/** F06 f3: "Remove this secret attachment?" */
export const RemoveSecretStory: Story = {
    name: "Remove secret",
    args: {dialog: "secret", ids},
    play: async ({canvasElement}) => {
        const bin = await within(canvasElement).findByRole("button", {
            name: `Remove ${SECRET_NAMES[0]}`,
        })
        await userEvent.click(bin)
        await screen.findByText("Remove this secret attachment?")
    },
}

/** F06 f4: "Delete this automation?" */
export const DeleteAutomationStory: Story = {
    name: "Delete automation",
    args: {dialog: "automation", ids},
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
    args: {dialog: "revert", ids},
}
