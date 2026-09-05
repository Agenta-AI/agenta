import {useState} from "react"

import {VersionsRailCard, type SkillVersionRow} from "@agenta/skills-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The VERSIONS rail card (artboards 2/2b) — replaces the drop zone in detail mode.
const meta = {
    title: "@agenta/skills-ui/VersionsRailCard",
    component: VersionsRailCard,
    parameters: {
        docs: {
            description: {
                component:
                    "Revision navigation at the bottom of the skill drawer's Files rail: " +
                    "version tag, commit message, age; click to view that revision.",
            },
        },
    },
} satisfies Meta<typeof VersionsRailCard>

export default meta
type Story = StoryObj<typeof meta>

const VERSIONS: SkillVersionRow[] = [
    {id: "r3", version: "3", message: "Tighten qpdf flags", age: "3d"},
    {id: "r2", version: "2", message: "sync: anthropics/skills@a1b2c3d", age: "1w"},
    {id: "r1", version: "1", message: "Imported from anthropics/skills", age: "2w"},
]

function Harness() {
    const [active, setActive] = useState("r3")
    return (
        <div className="w-44">
            <VersionsRailCard
                versions={VERSIONS}
                activeId={active}
                onSelect={(row) => setActive(row.id)}
            />
        </div>
    )
}

export const History: Story = {
    args: {} as never,
    render: () => <Harness />,
}
