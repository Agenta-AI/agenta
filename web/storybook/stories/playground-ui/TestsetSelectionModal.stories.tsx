import {TestsetSelectionModal} from "@agenta/playground-ui/testset-selection"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {populatedTestsetQueries} from "./_fixtures/testsetSelection"

/**
 * The modal shell around `LoadModeContent` — title, width, and the "content only mounts when
 * open" rule that keeps the data subscriptions off until the user opens it.
 *
 * Two things to know when reading these:
 *
 * - **The body is a portal.** `EnhancedModal` renders outside the story root, so a check that
 *   looks only at the story container sees an empty page even when the modal is fine. The
 *   crash-check has to read `document.body`.
 * - **`open={false}` renders nothing by design** — that is the point of the wrapper, and
 *   `Closed` below exists to record it rather than to look at.
 *
 * Fixtures and the `session: false` requirement are shared with `LoadModeContent.stories.tsx`;
 * see that file's header for why the gate must be closed as well as the cache seeded.
 */
const meta = {
    title: "@agenta/playground-ui/TestsetSelection/Modal",
    component: TestsetSelectionModal,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component: "Modal chrome for the testset picker, in load and edit modes.",
            },
        },
    },
} satisfies Meta<typeof TestsetSelectionModal>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const base = {
    loadableId: "loadable-1",
    onConfirm: noop,
    onCancel: noop,
    open: true,
} as const

const seeded = {
    agenta: {
        session: false,
        queries: (scope: {projectId: string}) => populatedTestsetQueries(scope.projectId),
    },
}

/** Load mode — title "Load Testset", body height 620. */
export const LoadMode: Story = {
    args: {...base, mode: "load"},
    parameters: seeded,
}

/** Edit mode — title "Edit Testcase Selection", already connected to a revision. */
export const EditMode: Story = {
    args: {
        ...base,
        mode: "edit",
        connectedTestsetId: "ts-support",
        connectedRevisionId: "rev-3",
    },
    parameters: seeded,
}

/** A warning banner above the picker (e.g. the connected revision moved on). */
export const WithWarning: Story = {
    args: {
        ...base,
        mode: "edit",
        connectedTestsetId: "ts-support",
        connectedRevisionId: "rev-3",
        hasWarning: true,
        warningMessage: "This testset has a newer revision. Reconnecting will replace your rows.",
    },
    parameters: seeded,
}

/**
 * Closed. Renders nothing — no chrome and, more importantly, no `TestsetSelectionModalContent`,
 * so none of the testset queries subscribe. An empty page is the correct result here.
 */
export const Closed: Story = {
    args: {...base, open: false, mode: "load"},
    parameters: {agenta: {session: false, queries: []}},
    render: (args) => (
        <div className="p-4">
            <div className="text-xs text-colorTextSecondary">
                Modal closed. Nothing below this line is expected to render — the content, and
                therefore every testset query, only mounts while `open` is true.
            </div>
            <TestsetSelectionModal {...args} />
        </div>
    ),
}
