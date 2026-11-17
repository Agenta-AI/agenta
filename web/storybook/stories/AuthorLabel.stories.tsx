import type {Meta, StoryObj} from "@storybook/nextjs"

// AuthorLabel is not re-exported from the presentational barrel; import it from the revision
// index directly (relative path, mirroring how non-barrel components are imported).
import {AuthorLabel} from "../../packages/agenta-ui/src/components/presentational/revision"

const meta = {
    title: "@agenta/ui/Presentational/Labels/AuthorLabel",
    component: AuthorLabel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'A pure presentational @agenta/ui span showing "by <author>" with a configurable prefix.\n\n**Used in:** 1 place — inside `RevisionLabel` (`@agenta/ui` presentational). No direct app call-site.',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            <Row label="default (by prefix)">
                <AuthorLabel author="user@example.com" />
            </Row>
            <Row label="custom prefix">
                <AuthorLabel author="Ada Lovelace" prefix="edited by" />
            </Row>
            <Row label="no prefix">
                <AuthorLabel author="user@example.com" showPrefix={false} />
            </Row>
        </div>
    ),
}
