import {useState} from "react"

import {
    CreateMenuButton,
    RepoImportDrawer,
    type CreateMenuOption,
    type RepoScanResult,
} from "@agenta/ui/create-menu"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The shared `+ New …` menu (skills and agents) and the import-from-repo drawer behind it.
const meta = {
    title: "@agenta/ui/CreateMenu",
    component: CreateMenuButton,
    parameters: {layout: "centered"},
} satisfies Meta<typeof CreateMenuButton>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined
const AGENT_OPTIONS: CreateMenuOption[] = [
    {kind: "write", title: "Start from scratch", hint: "An empty agent", onSelect: noop},
    {kind: "upload", title: "Upload", hint: "An agent template .zip", onFiles: noop},
    {kind: "import", title: "Import from a repo", hint: "A public GitHub repo", onSelect: noop},
]

export const AgentMenu: Story = {args: {label: "New agent", options: AGENT_OPTIONS}}

export const Creating: Story = {args: {label: "New agent", options: AGENT_OPTIONS, loading: true}}

const FOUND: RepoScanResult = {
    candidates: Array.from({length: 7}, (_, i) => ({
        path: `packages/template-${i}`,
        name: `template-${i}`,
        description: i === 2 ? null : `What template ${i} does, in one line.`,
        unavailable: i === 6 ? "plugin.json is invalid." : null,
    })),
}

const DrawerPreview = ({fail}: {fail?: boolean}) => {
    const [open, setOpen] = useState(true)
    return (
        <div className="p-6">
            <Button onClick={() => setOpen(true)}>Import from a repo…</Button>
            <RepoImportDrawer
                open={open}
                onClose={() => setOpen(false)}
                title="Import an agent from a repo"
                hint="Scan a public GitHub repository for agent templates."
                noun="agent templates"
                scan={async () => {
                    await new Promise((resolve) => setTimeout(resolve, 600))
                    if (fail) throw new Error("The repository was not found on GitHub.")
                    return FOUND
                }}
                confirmLabel={() => "Create agent"}
                onConfirm={async () => undefined}
            />
        </div>
    )
}

/** Type any URL and scan: the fake scan answers with seven templates (search shows past five). */
export const ImportDrawer: Story = {
    args: {label: "", options: []},
    parameters: {layout: "fullscreen"},
    render: () => <DrawerPreview />,
}

export const ImportDrawerScanFails: Story = {
    args: {label: "", options: []},
    parameters: {layout: "fullscreen"},
    render: () => <DrawerPreview fail />,
}
