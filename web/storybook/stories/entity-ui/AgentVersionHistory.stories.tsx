import type {ChangeSection} from "@agenta/entities/workflow/commitDiff"
import type {AgentVersionRow} from "@agenta/playground/state"
import {ChangesPane, RevertFooter, VersionList} from "@agenta/playground-ui/agent-version-history"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The version-history drawer's three panes (#6405), in the states a reviewer cannot click to.
// Widths match the real drawer (780px, 250px rail) so rows wrap as they do in situ.

const meta = {
    title: "@agenta/playground-ui/AgentVersionHistory",
    parameters: {layout: "padded"},
} satisfies Meta

export default meta

const HOUR = 3_600_000
// Relative to load time so the rows read "2 hours ago", not "281d ago".
const now = Date.now()

const rows: AgentVersionRow[] = [
    {
        id: "r4",
        version: 4,
        message: "Tighten refusal wording and add the Write tool",
        createdAt: new Date(now - 2 * HOUR).toISOString(),
        isCurrent: true,
        isLatest: true,
        isReverted: false,
    },
    {
        id: "r3",
        version: 3,
        message: 'Revert to v1 — "Initial commit"',
        createdAt: new Date(now - 72 * HOUR).toISOString(),
        isCurrent: false,
        isLatest: false,
        isReverted: true,
    },
    {
        id: "r2",
        version: 2,
        message: "Add the Linear MCP server",
        createdAt: new Date(now - 144 * HOUR).toISOString(),
        isCurrent: false,
        isLatest: false,
        isReverted: false,
    },
    {
        id: "r1",
        version: 1,
        message: null,
        createdAt: new Date(now - 336 * HOUR).toISOString(),
        isCurrent: false,
        isLatest: false,
        isReverted: false,
    },
]

const Rail = ({children}: {children: React.ReactNode}) => (
    <div className="flex h-[420px] w-[250px] flex-col">{children}</div>
)

const listArgs = {
    rows,
    selectedId: "r2",
    isLoading: false,
    isError: false,
    onRetry: () => undefined,
    onSelect: () => undefined,
}

type ListStory = StoryObj<typeof VersionList>

/** v2 is selected. v4 is Current — it IS the configuration on screen, so its row is disabled. */
export const List: ListStory = {
    render: (args) => (
        <Rail>
            <VersionList {...args} />
        </Rail>
    ),
    args: listArgs,
}

export const ListLoading: ListStory = {
    ...List,
    args: {...listArgs, isLoading: true},
}

export const ListError: ListStory = {
    ...List,
    args: {...listArgs, isError: true},
}

/** A brand-new agent: one commit, so there is nothing to compare or restore. */
export const ListSingleVersion: ListStory = {
    ...List,
    args: {...listArgs, rows: [rows[0]], selectedId: null},
}

export const ListEmpty: ListStory = {
    ...List,
    args: {...listArgs, rows: [], selectedId: null},
}

const sections: ChangeSection[] = [
    {
        id: "model",
        title: "Model & harness",
        tags: [{kind: "changed", label: "1 changed"}],
        totalCount: 1,
        scalarChanges: [
            {
                key: "agent.model",
                before: "claude-opus-4-1",
                after: "claude-sonnet-4-5",
                kind: "changed",
            },
        ],
    },
    {
        id: "tools",
        title: "Integrations",
        noun: "integration",
        tags: [
            {kind: "added", label: "1 added"},
            {kind: "removed", label: "2 removed"},
        ],
        totalCount: 3,
        items: [
            {id: "t1", label: "Search", kind: "added"},
            {id: "t2", label: "Write", kind: "removed"},
            {id: "t3", label: "Fetch", kind: "removed"},
        ],
    },
    {
        id: "subagents",
        title: "Subagents",
        noun: "subagent",
        tags: [{kind: "added", label: "1 added"}],
        totalCount: 1,
        items: [{id: "s1", label: "hourly-news", kind: "added"}],
    },
]

const Pane = ({children}: {children: React.ReactNode}) => (
    <div className="flex h-[420px] w-[520px] flex-col">{children}</div>
)

type PaneStory = StoryObj<typeof ChangesPane>

export const Changes: PaneStory = {
    render: (args) => (
        <Pane>
            <ChangesPane {...args} />
        </Pane>
    ),
    args: {sections, version: 2, message: "Add the Linear MCP server", isLoading: false},
}

export const ChangesLoading: PaneStory = {
    ...Changes,
    args: {sections: [], version: 2, message: "Add the Linear MCP server", isLoading: true},
}

/** Selected version's configuration is byte-identical to the current one. */
export const ChangesIdentical: PaneStory = {
    ...Changes,
    args: {sections: [], version: 2, message: "Add the Linear MCP server", isLoading: false},
}

export const ChangesNoSelection: PaneStory = {
    ...Changes,
    args: {
        sections: [],
        version: null,
        isLoading: false,
        placeholder: "Pick a version to see what restoring it would change.",
    },
}

const footerArgs = {
    selectedVersion: 2,
    currentVersion: 4,
    revertedFrom: 2,
    disabled: false,
    onRequestConfirm: () => undefined,
    onCancel: () => undefined,
    onConfirm: () => undefined,
    onClose: () => undefined,
}

type FooterStory = StoryObj<typeof RevertFooter>

const Footer = ({children}: {children: React.ReactNode}) => (
    <div className="w-[780px] border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] px-4 py-3">
        {children}
    </div>
)

export const FooterIdle: FooterStory = {
    render: (args) => (
        <Footer>
            <RevertFooter {...args} />
        </Footer>
    ),
    args: {...footerArgs, phase: "idle"},
}

/** Nothing to restore — the selection is the current configuration. */
export const FooterDisabled: FooterStory = {
    ...FooterIdle,
    args: {...footerArgs, phase: "idle", disabled: true},
}

export const FooterConfirm: FooterStory = {
    ...FooterIdle,
    args: {...footerArgs, phase: "confirm"},
}

export const FooterReverting: FooterStory = {
    ...FooterIdle,
    args: {...footerArgs, phase: "reverting"},
}

export const FooterDone: FooterStory = {
    ...FooterIdle,
    args: {...footerArgs, phase: "done", currentVersion: 5},
}

export const FooterFailed: FooterStory = {
    ...FooterIdle,
    args: {...footerArgs, phase: "failed"},
}
