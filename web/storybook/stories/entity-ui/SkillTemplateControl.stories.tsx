import type {ReactNode} from "react"

import {SkillTemplateControl} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SkillTemplateControl — one `skills[]` entry: an inline SKILL.md package, an `@ag.embed`
// reference, or a static (Agenta-owned) read-only skill. Rendered without a `SharedEditor`
// injection, so it takes the documented textarea fallback branch.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SkillTemplateControl",
    component: SkillTemplateControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Schema-driven control for one declared skill. Inline package, `@ag.embed` reference, and the static Agenta-owned read-only variant.",
            },
        },
    },
} satisfies Meta<typeof SkillTemplateControl>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const INLINE_SKILL = {
    name: "release-notes",
    description: "Draft release notes from a changelog",
    body: "# Release notes\n\nSummarise the changelog in three bullets.",
}

const EMBED_SKILL = {
    "@ag.embed": {
        "@ag.references": {workflow: {slug: "changelog-writer"}},
    },
}

const STATIC_SKILL = {
    "@ag.embed": {
        "@ag.references": {workflow_revision: {slug: "__ag__web_search", version: "v3"}},
    },
}

const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {value: INLINE_SKILL},
    render: () => (
        // Reveals the hover-only remove control.
        <div className="flex max-w-[640px] flex-col [&_.invisible]:!visible">
            <Row label="inline skill">
                <SkillTemplateControl value={INLINE_SKILL} onDelete={noop} onChange={noop} />
            </Row>
            <Row label="@ag.embed reference">
                <SkillTemplateControl value={EMBED_SKILL} onDelete={noop} onChange={noop} />
            </Row>
            <Row label="static skill">
                <SkillTemplateControl value={STATIC_SKILL} onDelete={noop} onChange={noop} />
            </Row>
        </div>
    ),
}
