import type {Meta, StoryObj} from "@storybook/nextjs"

// AuthorLabel is not re-exported from the presentational barrel; import it from the revision
// index directly (relative path, mirroring how non-barrel components are imported).
import {AuthorLabel} from "../../packages/agenta-ui/src/components/presentational/revision"

// AuthorLabel — a pure presentational span showing "by <author>". Verified: no revision of
// AuthorLabel.tsx has ever imported antd, so there is no pre-migration baseline to diff against.
// The antd cell carries the established "agenta only, no antd counterpart" caption, which makes the
// VRT drop the row instead of comparing a caption against a real control. Legitimately unmeasured.
const meta = {
    title: "@agenta/ui/Presentational/Labels/AuthorLabel",
    component: AuthorLabel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'A pure presentational @agenta/ui span showing "by <author>" with a configurable prefix. No antd counterpart.\n\n**Used in:** 1 place — inside `RevisionLabel` (`@agenta/ui` presentational). No direct app call-site.',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const AntdOnly = () => (
    <span className="text-[10px] italic text-colorTextSecondary">
        agenta only, no antd counterpart
    </span>
)

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="default (by prefix)"
                a={<AntdOnly />}
                s={<AuthorLabel author="user@example.com" />}
            />
            <Row
                label="custom prefix"
                a={<AntdOnly />}
                s={<AuthorLabel author="Ada Lovelace" prefix="edited by" />}
            />
            <Row
                label="no prefix"
                a={<AntdOnly />}
                s={<AuthorLabel author="user@example.com" showPrefix={false} />}
            />
        </div>
    ),
}
