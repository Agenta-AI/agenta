import {useState} from "react"

import {LoadError} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {PickAppState} from "../../../mobile/src/features/variants/states/PickAppState"
import {VariantsEmpty} from "../../../mobile/src/features/variants/states/VariantsEmpty"
import {VariantsNoMatch} from "../../../mobile/src/features/variants/states/VariantsNoMatch"
import type {AppRevisionRow} from "../../../mobile/src/features/variants/useAppRevisions"
import {VariantsTable} from "../../../mobile/src/features/variants/VariantsTable"
import {toRevisionGroups} from "../../../mobile/src/features/variants/variantsView"

/**
 * The Variants tab of the registry page: the revision table in its states, flat and grouped.
 * The table takes rows as props, so the stories need no data.
 */

const row = (
    n: number,
    variantId: string,
    variantName: string,
    version: number,
    overrides: Partial<AppRevisionRow> = {},
): AppRevisionRow => ({
    revisionId: `rev-${n}`,
    workflowId: "app-1",
    variantId,
    variantName,
    variantSlug: `invoice-helper.${variantId}`,
    version,
    model: "gpt-4o-mini",
    message: n % 2 ? "Lower the temperature" : null,
    createdAt: "2026-01-0" + ((n % 8) + 1) + "T10:00:00Z",
    createdById: null,
    ...overrides,
})

const ROWS: AppRevisionRow[] = [
    row(5, "v-support", "Support", 3),
    row(4, "v-billing", "Billing", 2),
    row(3, "v-support", "Support", 2),
    row(2, "v-billing", "Billing", 1),
    row(1, "v-support", "Support", 1, {model: ""}),
]

interface DemoProps {
    mode: "variants" | "revisions"
    loading?: boolean
    rows?: AppRevisionRow[]
    canDeploy?: boolean
    canDelete?: boolean
    /** The playground view is on: the row menu links to the playground. */
    playground?: boolean
    empty?: "none" | "noMatch"
}

const Demo = ({
    mode,
    loading = false,
    rows = ROWS,
    canDeploy = true,
    canDelete = true,
    playground = false,
    empty = "none",
}: DemoProps) => {
    const [view, setView] = useState(mode)
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    return (
        <div className="mx-auto max-w-5xl p-4 text-foreground">
            <div className="mb-3 flex gap-2">
                <button type="button" onClick={() => setView("variants")}>
                    Group by variant
                </button>
                <button type="button" onClick={() => setView("revisions")}>
                    Flat list
                </button>
            </div>
            <VariantsTable
                groups={toRevisionGroups(rows, view)}
                isLoading={loading}
                latestRevisionId="rev-5"
                canDeploy={canDeploy}
                canDelete={canDelete}
                playgroundHref={
                    playground
                        ? (item) =>
                              `/w/ws/p/proj/apps/app-1/playground?revisions=${item.revisionId}`
                        : null
                }
                collapsed={collapsed}
                onCollapsedChange={setCollapsed}
                onOpen={() => undefined}
                onDeploy={() => undefined}
                onDelete={() => undefined}
                empty={
                    empty === "noMatch" ? (
                        <VariantsNoMatch term="billing" onClear={() => undefined} />
                    ) : (
                        <VariantsEmpty />
                    )
                }
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Variants/VariantsScreen",
    component: Demo,
    parameters: {
        layout: "fullscreen",
        agenta: {
            // The revision cells read each revision's environments. An empty list keeps the story offline.
            queries: (scope: {projectId: string}) => [
                [["environments-list", scope.projectId, false], {count: 0, environments: []}],
            ],
        },
    },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const Flat: Story = {args: {mode: "revisions"}}

export const Grouped: Story = {
    args: {mode: "variants"},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await userEvent.click(await screen.findByRole("button", {name: "Flat list"}))
        await userEvent.click(await screen.findByRole("button", {name: "Group by variant"}))
        const menus = await screen.findAllByRole("button", {name: "Revision actions"})
        await userEvent.click(menus[0])
        await expect(await within(document.body).findByText("View details")).toBeInTheDocument()
    },
}

export const Loading: Story = {args: {mode: "revisions", loading: true, rows: []}}

export const Empty: Story = {args: {mode: "revisions", rows: []}}

export const NoMatch: Story = {args: {mode: "revisions", rows: [], empty: "noMatch"}}

export const ReadOnly: Story = {args: {mode: "revisions", canDeploy: false, canDelete: false}}

export const Phone: Story = {
    args: {mode: "variants"},
    globals: {viewport: {value: "mobile1", isRotated: false}},
}

/** The revisions request failed. */
export const LoadFailed: Story = {
    args: {mode: "revisions"},
    render: () => (
        <div className="mx-auto max-w-5xl p-4 text-foreground">
            <LoadError framed title="Could not load variants" onRetry={() => undefined} />
        </div>
    ),
}

/** No app is chosen yet. */
export const PickApp: Story = {
    args: {mode: "revisions"},
    render: () => (
        <div className="mx-auto max-w-5xl p-4 text-foreground">
            <PickAppState />
        </div>
    ),
}

/** The playground view is on: a revision's menu opens it in the playground. */
export const OpenInPlayground: Story = {
    args: {mode: "revisions", playground: true},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        const menus = await screen.findAllByRole("button", {name: "Revision actions"})
        await userEvent.click(menus[0])
        await expect(
            await within(document.body).findByText("Open in playground"),
        ).toBeInTheDocument()
    },
}
