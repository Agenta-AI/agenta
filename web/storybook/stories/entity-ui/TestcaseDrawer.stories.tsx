import {useState} from "react"

import {TestcaseDrawer} from "@agenta/entity-ui/testcase"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * Showcase stories (agenta only — NOT pixel pairs) for the antd→@agenta/ui migration of
 * `TestcaseDrawer`. The component is an `EnhancedDrawer` overlay that portals to `body`,
 * so its chrome cannot sit inside a `[label | antd | agenta]` grid cell for the VRT.
 * Every swapped piece is covered by primitive parity stories instead: ghost icon Buttons
 * (Button), header Tooltips (Tooltip), the footer split-button (DropdownButton — the same
 * `@agenta/ui/components` composition, replacing antd `Space.Compact` + `Dropdown`),
 * `Skeleton active paragraph={{rows: 8}}` (Skeleton), and the error `Alert` (Alert).
 *
 * Open each story in light AND dark; the drawer opens immediately.
 */
const meta = {
    title: "@agenta/entity-ui/Testcase/TestcaseDrawer",
    component: TestcaseDrawer,
} satisfies Meta<typeof TestcaseDrawer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

interface DemoProps {
    isLoading?: boolean
    isError?: boolean
    isDirty?: boolean
    viewOnly?: boolean
}

const DrawerDemo = ({isLoading = false, isError = false, isDirty = false, viewOnly}: DemoProps) => {
    const [open, setOpen] = useState(true)
    return (
        <div className="p-4">
            <Button variant="outline" onClick={() => setOpen(true)}>
                Open testcase drawer
            </Button>
            <TestcaseDrawer
                open={open}
                onClose={() => setOpen(false)}
                testcaseId="tc-story-1"
                isNewRow={false}
                testcaseNumber={3}
                onPrevious={noop}
                onNext={noop}
                hasPrevious
                hasNext={false}
                onOpenCommitModal={noop}
                onSaveTestset={async () => null}
                testcaseData={isLoading || isError ? null : {input: "What is Agenta?"}}
                isLoading={isLoading}
                isError={isError}
                errorMessage={isError ? "Request failed with status 500" : undefined}
                isDirty={isDirty}
                viewOnly={viewOnly}
                enableRootViewMode
                renderContent={() => (
                    <div className="p-6 text-xs text-colorTextSecondary">
                        renderContent() output goes here — the drawer shell is what this story
                        exercises.
                    </div>
                )}
            />
        </div>
    )
}

/** Header chrome + footer split-button (dirty → footer actions enabled). */
export const Default: Story = {
    args: {
        open: true,
        onClose: noop,
        testcaseId: "tc-story-1",
        isNewRow: false,
        testcaseData: {},
        isLoading: false,
        isError: false,
        isDirty: true,
        renderContent: () => null,
    },
    render: () => <DrawerDemo isDirty />,
}

/** Loading state — `Skeleton active paragraph={{rows: 8}}`. */
export const Loading: Story = {
    args: Default.args,
    render: () => <DrawerDemo isLoading />,
}

/** Error state — the error `Alert` with message + description. */
export const ErrorState: Story = {
    args: Default.args,
    render: () => <DrawerDemo isError />,
}

/** viewOnly — no footer, no edited badge. */
export const ViewOnly: Story = {
    args: Default.args,
    render: () => <DrawerDemo viewOnly />,
}
