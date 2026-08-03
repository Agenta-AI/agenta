import type {ReactNode} from "react"

import {SkillTemplateControl} from "@agenta/entity-ui/drill-in"
import {MinusCircle} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Button as AntButton,
    Tag as AntTag,
    Tooltip as AntTooltip,
    Typography as AntTypography,
} from "antd"

// SkillTemplateControl — one `skills[]` entry: an inline SKILL.md package, an `@ag.embed`
// reference, or a static (Agenta-owned) read-only skill. Rendered without a `SharedEditor`
// injection, so both halves take the documented textarea fallback branch.
//
// The antd half replays the pre-migration header/static card verbatim from
// feat/storybook-data-seam (antd `Typography.Text`, `Tag`, `Tooltip title`, icon `Button`).
//
// antd swaps: `Tag color="blue"` → `Badge variant="blue"`, bare `Tag` → `Badge` (antd's
// `margin-inline-end: 8px` is NOT reproduced — Badge has no trailing margin, which is why
// the old call-sites carried `m-0`); `Typography.Text` → span + token classes;
// `Tooltip title` → Radix Tooltip; icon-only `Button type="text" size="small"` →
// `variant="ghost" size="icon-sm"` + `aria-label`.
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

const json = (value: unknown) => JSON.stringify(value, null, 2)

// ---------------------------------------------------------------------------
// Pre-migration card, verbatim (antd baseline)
// ---------------------------------------------------------------------------

const AntdHeaderActions = () => (
    <AntTooltip title="Remove">
        <AntButton
            icon={<MinusCircle size={14} />}
            type="text"
            size="small"
            className="invisible group-hover/skill:visible shrink-0"
        />
    </AntTooltip>
)

const AntdCard = ({
    name,
    embed,
    value,
}: {
    name: string
    embed?: boolean
    value: Record<string, unknown>
}) => (
    <div className="group/skill flex flex-col gap-2 border rounded-lg p-3">
        <div className="w-full flex items-center justify-between gap-2 py-1">
            <div className="flex items-center gap-2 min-w-0">
                <AntTypography.Text strong className="text-sm truncate">
                    {name}
                </AntTypography.Text>
                {embed && <AntTag color="blue">@ag.embed</AntTag>}
            </div>
            <AntdHeaderActions />
        </div>
        <textarea
            className="font-mono text-xs p-2 border rounded min-h-[120px] resize-y w-full"
            aria-label="Skill JSON"
            defaultValue={json(value)}
            readOnly
        />
    </div>
)

const AntdStaticCard = () => (
    <div className="group/skill flex flex-col gap-1 border rounded-lg p-3 w-full max-w-full">
        <div className="flex items-center gap-2 min-w-0">
            <AntTypography.Text strong className="text-sm truncate">
                Skill reference
            </AntTypography.Text>
            <AntTag color="default">Static skill</AntTag>
            <AntTag color="default">v3</AntTag>
        </div>
        <AntTypography.Text type="secondary" className="text-xs font-mono truncate">
            __ag__web_search
        </AntTypography.Text>
        <AntTypography.Text type="secondary" className="text-xs">
            Provided by Agenta. This skill cannot be edited or removed.
        </AntTypography.Text>
    </div>
)

// ---------------------------------------------------------------------------
// Parity grid
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {value: INLINE_SKILL},
    render: () => (
        // Reveals the hover-only remove control on BOTH halves (identical classes).
        <div className="flex max-w-[1100px] flex-col [&_.invisible]:!visible">
            <Row
                label="inline skill"
                a={<AntdCard name="release-notes" value={INLINE_SKILL} />}
                s={<SkillTemplateControl value={INLINE_SKILL} onDelete={noop} onChange={noop} />}
            />
            <Row
                label="@ag.embed reference"
                a={<AntdCard name="Skill reference" embed value={EMBED_SKILL} />}
                s={<SkillTemplateControl value={EMBED_SKILL} onDelete={noop} onChange={noop} />}
            />
            <Row
                label="static skill"
                a={<AntdStaticCard />}
                s={<SkillTemplateControl value={STATIC_SKILL} onDelete={noop} onChange={noop} />}
            />
        </div>
    ),
}
