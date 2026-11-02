import {useState} from "react"

import {SkillImportDrawer} from "@agenta/skills-ui"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The import-from-repo flow (WP-W5). CONNECTED: scan/import call the live
// /skills/sources API, so in Storybook only the URL step is reachable — the
// select and summary steps need a running backend (scan fails with the error
// row here, which doubles as the error-state preview).
const meta = {
    title: "@agenta/skills-ui/SkillImportDrawer",
    component: SkillImportDrawer,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Paste a GitHub URL → server scan lists SKILL.md candidates → pick → " +
                    "import → summary with imported/skipped rows. Invalid candidates render " +
                    "disabled with their issue text; a Keep-in-sync switch enables refresh.",
            },
        },
    },
} satisfies Meta<typeof SkillImportDrawer>

export default meta
type Story = StoryObj<typeof meta>

const UrlStepPreview = ({projectId}: {projectId: string}) => {
    const [open, setOpen] = useState(true)
    return (
        <div className="p-6">
            <Button onClick={() => setOpen(true)}>Import from a repo…</Button>
            <SkillImportDrawer open={open} onClose={() => setOpen(false)} projectId={projectId} />
        </div>
    )
}

export const UrlStep: Story = {
    args: {open: true, onClose: () => undefined, projectId: "storybook-project"},
    render: (args) => <UrlStepPreview projectId={args.projectId} />,
}
