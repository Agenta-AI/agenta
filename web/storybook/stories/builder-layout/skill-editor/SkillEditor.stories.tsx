import {useEffect} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {DrillInUIProvider} from "@agenta/entity-ui/drill-in"
import {SkillDetailDrawer, useSkillsBridge} from "@agenta/skills-ui"
import {useViewStack, ViewStackHost} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, waitFor, within} from "storybook/test"

// Imported from source: the package barrel does not re-export the agent's views.
import {skillView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/skillView"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    skillEditorQueries,
    skillEditorRevisionId,
    skillItemKeys,
} from "../../../fixtures/builderLayout/skill-editor"

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

type Kind = "agentOnly" | "registry"

/** Opens the skill view the way a click on the skill's row does. */
const Open = ({kind, revisionId}: {kind: Kind; revisionId: string}) => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(
            skillView,
            {item: {list: "skills", key: skillItemKeys[kind]}},
            {kind: "agent_draft", revisionId},
        )
        // Open once on mount, like a click.
    }, [])
    return null
}

/** The Agent tab's view stack in the right panel (440 x 820), with one skill open. */
const PanelFrame = ({kind, revisionId}: {kind: Kind; revisionId: string}) => {
    const skills = useSkillsBridge()
    return (
        <DrillInUIProvider components={{skills}}>
            <AgentPanelContext.Provider value={panel}>
                <div
                    data-testid="agent-panel"
                    className="ag-panel-raised flex h-[820px] w-[440px] flex-col border border-solid border-border"
                >
                    <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                        <Open kind={kind} revisionId={revisionId} />
                    </ViewStackHost>
                </div>
            </AgentPanelContext.Provider>
        </DrillInUIProvider>
    )
}

const meta = {
    title: "BuilderLayout/F07 Skill editor",
    component: PanelFrame,
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) => skillEditorQueries(scope),
            args: (scope: StoryScope) => ({revisionId: skillEditorRevisionId(scope)}),
        },
    },
} satisfies Meta<typeof PanelFrame>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** The file button: the menu trigger that names the open file (the "…" trigger has no title). */
const openFileMenu = async (canvasElement: HTMLElement) => {
    let button: HTMLElement | null = null
    await waitFor(() => {
        button = canvasElement.querySelector<HTMLElement>('button[aria-haspopup="dialog"][title]')
        expect(button).toBeTruthy()
    })
    await userEvent.click(button as unknown as HTMLElement)
    return body().findByPlaceholderText("Find a file")
}

const openFile = async (canvasElement: HTMLElement, name: string) => {
    await openFileMenu(canvasElement)
    await userEvent.click(await body().findByText(name))
}

/** F07 f1: the skill opens on SKILL.md with Name, Description, the editor and Advanced. */
export const SkillMdOpen: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText("Only available to this agent")
    },
}

/** F07 f2: the file menu, SKILL.md first, folders from the paths. */
export const FileMenu: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        await openFileMenu(canvasElement)
        await body().findByText("references")
    },
}

/** F07 f3: search by name and folder; Enter opens the first one. */
export const Search: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        const search = await openFileMenu(canvasElement)
        await userEvent.type(search, "re")
        await body().findByText(/Enter opens the first one/)
    },
}

/** F07 f4: a code file with its path, "Mark executable" and the code editor. */
export const CodeFile: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        await openFile(canvasElement, "classify_ticket.py")
        await within(canvasElement).findByText("Change the path to rename or move the file.")
    },
}

/** F07 f5: two files edited (dots, "2 edited"), the menu open. */
export const RowActions: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.type(await canvas.findByPlaceholderText("my-skill"), "-v2")
        await openFile(canvasElement, "classify_ticket.py")
        await userEvent.type(await canvas.findByPlaceholderText("scripts/foo.py"), "x")
        await waitFor(() => expect(canvas.getAllByText(/2 edited/).length).toBeGreaterThan(0))
        await openFileMenu(canvasElement)
    },
}

/** F07 f6: "Add a file" with a folder in the path. */
export const AddFile: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        await openFileMenu(canvasElement)
        await userEvent.click(await body().findByText("Add a file"))
        const path = await within(canvasElement).findByPlaceholderText("scripts/foo.py")
        await userEvent.type(path, "references/pricing.md")
    },
}

/** F07 f6, refused: a path another file already has. */
export const DuplicatePath: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        await openFileMenu(canvasElement)
        await userEvent.click(await body().findByText("Add a file"))
        const path = await within(canvasElement).findByPlaceholderText("scripts/foo.py")
        await userEvent.type(path, "examples.md")
        await within(canvasElement).findByText("Another file of this skill has this path.")
    },
}

/** F07 f7: upload with "Add to this skill" (default) or "Replace the whole skill". */
export const Upload: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        await openFileMenu(canvasElement)
        await userEvent.click(await body().findByText("Upload a folder or a .zip"))
        await within(canvasElement).findByText("Add to this skill")
    },
}

/** F07 f8: Advanced, open. */
export const Advanced: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: /Advanced/}))
        await canvas.findByText("Hide from prompt")
    },
}

/** F07 f8b: the editor, expanded. */
export const Expanded: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: "Expand the editor"}))
        await canvas.findByRole("button", {name: "Make the editor smaller"})
    },
}

/** F07 f9: a registry skill; the "…" menu has "Download as .zip" and "Archive". */
export const RegistryMenu: Story = {
    args: {kind: "registry", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await canvas.findByText(/Shared in your skill registry/)
        await userEvent.click(await canvas.findByRole("button", {name: "Skill actions"}))
        await body().findByText("Archive")
    },
}

/** F07 f10: an agent-only skill; the "…" menu has "Publish to skill registry". */
export const AgentOnlyMenu: Story = {
    args: {kind: "agentOnly", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: "Skill actions"}))
        await body().findByText("Publish to skill registry")
    },
}

/** K01: a registry skill opened in the panel, with its file menu. */
export const RegistryFileMenu: Story = {
    args: {kind: "registry", revisionId: ""},
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText(/Shared in your skill registry/)
        await openFileMenu(canvasElement)
    },
}

/** The Skills page: the same view in its drawer, with "Used by" and "Add to agent". */
export const SkillsPage: Story = {
    args: {kind: "registry", revisionId: ""},
    render: () => (
        <SkillDetailDrawer
            open
            onClose={() => undefined}
            skill={{
                id: "",
                slug: "plain-writing",
                workflowSlug: skillItemKeys.registry,
                name: "plain-writing",
                origin: "project",
            }}
        />
    ),
    play: async () => {
        await body().findByText(/Used by 3 agents/)
    },
}
