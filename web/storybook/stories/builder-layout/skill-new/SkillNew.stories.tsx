import {useEffect, type ReactNode} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {ConfigurationRoot} from "@/features/agent-layout/ConfigurationRoot"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {AgentEditorContext, DrillInUIProvider} from "@agenta/entity-ui/drill-in"
import {useSkillsBridge} from "@agenta/skills-ui"
import {useViewStack, ViewStackHost} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, waitFor, within} from "storybook/test"

// Imported from source: the package barrel does not re-export the agent's views.
import {skillAddView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/skillAddView"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    skillNewAgentTabQueries,
    skillNewQueries,
    skillNewRevisionId,
} from "../../../fixtures/builderLayout/skill-new"
import {workflowIds} from "../../../fixtures/workflow"

const panel: AgentPanelApi = {
    content: "configuration",
    toggle: async () => true,
    close: async () => true,
    configTab: "agent",
    setConfigTab: () => undefined,
    wide: false,
    setWide: () => undefined,
    phone: false,
    available: {files: true, configuration: true, builder: false},
}

const PANEL = "ag-panel-raised flex h-[820px] w-[440px] flex-col border border-solid border-border"

/** Opens "Add skills" the way "Add manually" does. */
const OpenAddSkills = ({revisionId}: {revisionId: string}) => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(skillAddView, {}, {kind: "agent_draft", revisionId})
        // Open once on mount, like a click.
    }, [])
    return null
}

/** The Agent tab's view stack in the right panel (440 x 820), with "Add skills" open. */
const AddSkillsPanel = ({revisionId}: {revisionId: string}) => {
    const skills = useSkillsBridge()
    return (
        <DrillInUIProvider components={{skills}}>
            <AgentPanelContext.Provider value={panel}>
                <AgentEditorContext.Provider value={{revisionId, readOnly: false}}>
                    <div data-testid="agent-panel" className={PANEL}>
                        <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                            <OpenAddSkills revisionId={revisionId} />
                        </ViewStackHost>
                    </div>
                </AgentEditorContext.Provider>
            </AgentPanelContext.Provider>
        </DrillInUIProvider>
    )
}

const meta = {
    title: "BuilderLayout/skill-new/New skill flows",
    component: AddSkillsPanel,
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) => skillNewQueries(scope),
            args: (scope: StoryScope) => ({revisionId: skillNewRevisionId(scope)}),
        },
    },
} satisfies Meta<typeof AddSkillsPanel>

export default meta
type Story = StoryObj<typeof meta>

const args = {revisionId: ""}

const openNewSkill = async (canvasElement: HTMLElement) => {
    const canvas = within(canvasElement)
    await canvas.findByText("refund-check")
    await userEvent.click(canvas.getByRole("button", {name: /New skill/}))
    await canvas.findByText("The new skill is added to your skill registry and to this agent.")
}

/** F04 f2: the registry, two rows "Added", search and "New skill", Done. */
export const AddSkills: Story = {
    args,
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText("refund-check")
    },
}

/** F04 f2: a click on a row adds it; the row shows "Added". */
export const AddOne: Story = {
    args,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: "Add refund-check"}))
        await canvas.findByRole("button", {name: "Remove refund-check"})
    },
}

/** F04 f2: a search with no result. */
export const SearchNoMatch: Story = {
    args,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await canvas.findByText("refund-check")
        await userEvent.type(canvas.getByPlaceholderText("Search skills..."), "zzz")
        await canvas.findByText("No skills match your search")
    },
}

/** F04 f2: an empty registry. */
export const EmptyRegistry: Story = {
    args,
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => skillNewQueries(scope, {emptyRegistry: true}),
            args: (scope: StoryScope) => ({revisionId: skillNewRevisionId(scope)}),
        },
    },
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText("No skills yet")
    },
}

/** F07 f12: "New skill", choose how. */
export const ChooseHow: Story = {
    args,
    play: async ({canvasElement}) => openNewSkill(canvasElement),
}

/** F07 f13: "Write from scratch", empty; "Create skill" is off. */
export const WriteFromScratch: Story = {
    args,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await openNewSkill(canvasElement)
        await userEvent.click(canvas.getByText("Write from scratch"))
        await canvas.findByText("Not saved yet")
        await waitFor(() =>
            expect(canvas.getByRole("button", {name: "Create skill"})).toBeDisabled(),
        )
    },
}

/** F07 f14: "Upload", the drop zone. */
export const Upload: Story = {
    args,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await openNewSkill(canvasElement)
        await userEvent.click(canvas.getByText("Upload"))
        await canvas.findByText("Browse files")
    },
}

/** F07 f15: "Import from a repo", the address field and "Scan" (the scan needs a backend). */
export const ImportFromRepo: Story = {
    args,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await openNewSkill(canvasElement)
        await userEvent.click(canvas.getByText("Import from a repo"))
        await canvas.findByRole("button", {name: "Scan"})
    },
}

/** The skills bridge, as the app's drill-in provider wires it. */
const SkillsBridgeProvider = ({children}: {children: ReactNode}) => {
    const skills = useSkillsBridge()
    return <DrillInUIProvider components={{skills}}>{children}</DrillInUIProvider>
}

/** F04 f1 and F06 f2: the Agent tab, the Skills "+" menu, and the remove dialog of a skill. */
const AgentTabPanel = ({
    projectId,
    workflowId,
    revisionId,
}: {
    projectId: string
    workflowId: string
    revisionId: string
}) => (
    <SkillsBridgeProvider>
        <AgentPanelContext.Provider value={panel}>
            <AgentEditorContext.Provider value={{revisionId, readOnly: false}}>
                <div data-testid="agent-panel" className={PANEL}>
                    <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                        <ConfigurationRoot
                            agentId={workflowId}
                            revisionId={revisionId}
                            sessionId="session"
                            filesScope="session"
                            workspaceId="workspace"
                            projectId={projectId}
                        />
                    </ViewStackHost>
                </div>
            </AgentEditorContext.Provider>
        </AgentPanelContext.Provider>
    </SkillsBridgeProvider>
)

const agentTab = {
    render: (props: {projectId: string; workflowId: string; revisionId: string}) => (
        <AgentTabPanel {...props} />
    ),
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => skillNewAgentTabQueries(scope),
            args: (scope: StoryScope) => workflowIds(scope),
        },
    },
}

/** F04 f1: "Create with AI" and "Add manually". */
export const PlusMenu: StoryObj<typeof AgentTabPanel> = {
    ...agentTab,
    args: {projectId: "", workflowId: "", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: "Add skill"}))
        await within(document.body).findByText("From your registry, or write one")
        await userEvent.click(within(document.body).getByText("Add manually"))
        await canvas.findByText("refund-check")
        // Back to the menu for the capture.
        await userEvent.click(canvas.getByRole("button", {name: "Agent"}))
        await userEvent.click(await canvas.findByRole("button", {name: "Add skill"}))
        await within(document.body).findByText("From your registry, or write one")
    },
}

/** F06 f2 for a skill: the row's bin asks first. */
export const RemoveDialog: StoryObj<typeof AgentTabPanel> = {
    ...agentTab,
    args: {projectId: "", workflowId: "", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        // The bin of the row "ticket-labels": the nearest parent with a Remove button.
        let row: HTMLElement | null = await canvas.findByText("ticket-labels")
        while (row && !within(row).queryByRole("button", {name: "Remove"})) row = row.parentElement
        await userEvent.click(within(row as HTMLElement).getByRole("button", {name: "Remove"}))
        await within(document.body).findByText(
            "This skill is only in this agent. Removing it deletes it.",
        )
    },
}
