import {LoadModeContent} from "@agenta/playground-ui/testset-selection"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {populatedTestsetQueries} from "./_fixtures/testsetSelection"

/**
 * LoadModeContent — the body of TestsetSelectionModal: testset sidebar on the left, a vertical
 * divider, and the search + testcase table on the right.
 *
 * These are **data-seam showcases**, not parity stories: the only antd this file ever had was
 * one `Divider`, and that swap is pixel-gated by the `vertical divider` row on
 * `TestsetSelectionPreview`. What is worth covering here is the container's states, because
 * this is the first component in wave 3 whose behaviour depends on seeded server data.
 *
 * ## How the fixtures were found
 *
 * Not by reading the source and guessing. `withAgentaData` subscribes to the query cache and
 * logs any key that actually tried to fetch:
 *
 *     [withAgentaData] no fixture for queryKey — add it to parameters.agenta.queries:
 *     ["testsets-list","project-34favu",""]
 *
 * So the loop is: render the story, read the console, add the key it names, repeat until the
 * console is quiet. That is the workflow the rest of wave 3 should copy — it seeds the exact
 * keys the component reads, which is the rule from wave 2, and it cannot drift from the source
 * because the source is what emits the warning.
 *
 * The project id is story-scoped (`scope.projectId`), so two stories can never collide on a
 * cache key — hence the function form of `queries`.
 *
 * ## Why every story here sets `session: false`
 *
 * This is the non-obvious part, and the rest of wave 3 will hit it.
 *
 * `withAgentaData`'s client sets `staleTime: Infinity` + `refetchOnMount: false` so a seeded
 * key never runs its `queryFn`. But a **per-query** option beats the client default, and
 * `testsetsListQueryAtomFamily` sets `refetchOnMount: "always"` (testset/state/store.ts:643).
 * So the list refetched anyway, hit the real API, failed, and the sidebar replaced the fixture
 * with `Error: Failed to fetch` — while the seeded testcases underneath rendered fine, which
 * made it look like a fixture problem rather than a refetch problem.
 *
 * `session: false` closes the auth gate (`enabled: get(sessionAtom) && Boolean(projectId)`),
 * so the query is disabled and never fetches — but TanStack still serves data already in the
 * cache. Net effect: fixtures render, nothing touches the network.
 *
 * **Rule of thumb: seed the cache AND close the session gate.** Leave the gate open only when
 * a story genuinely needs a query to run.
 */
const meta = {
    title: "@agenta/playground-ui/TestsetSelection/LoadModeContent",
    component: LoadModeContent,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Testset picker body. Data-seam showcases: loading, empty, and populated.",
            },
        },
    },
} satisfies Meta<typeof LoadModeContent>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const base = {loadableId: "loadable-1", onConfirm: noop, onCancel: noop}

const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="h-[560px] w-full bg-colorBgContainer">{children}</div>
)

/**
 * No fixtures and the gate closed, so `testsets-list` is disabled with nothing cached — the
 * frame the modal shows before data arrives. A seeded fixture resolves synchronously and never
 * has a pending render, so this is the only way to see the pre-data state in the harness.
 */
export const Loading: Story = {
    args: base,
    parameters: {agenta: {session: false, queries: []}},
    render: (args) => (
        <Frame>
            <LoadModeContent {...args} />
        </Frame>
    ),
}

/** Project has no testsets yet — the sidebar's empty branch. */
export const Empty: Story = {
    args: base,
    parameters: {
        agenta: {
            session: false,
            queries: (scope: {projectId: string}) => [
                [["testsets-list", scope.projectId, ""], {testsets: [], count: 0}],
            ],
        },
    },
    render: (args) => (
        <Frame>
            <LoadModeContent {...args} />
        </Frame>
    ),
}

/** The ordinary case: a handful of testsets to pick from. */
export const Populated: Story = {
    args: base,
    parameters: {
        agenta: {
            session: false,
            queries: (scope: {projectId: string}) => populatedTestsetQueries(scope.projectId),
        },
    },
    render: (args) => (
        <Frame>
            <LoadModeContent {...args} />
        </Frame>
    ),
}
