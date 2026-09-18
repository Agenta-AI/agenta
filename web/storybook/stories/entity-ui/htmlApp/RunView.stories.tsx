import {useEffect, useMemo, useState} from "react"

import {type FsRequest, type GrantLevel, type MockHtmlAppHostOptions} from "@agenta/entities/drive"
import {KIT_CSS, RunView} from "@agenta/entity-ui/drive"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    APP_DIR,
    BOARD_APP,
    BOARD_APP_NO_DATA,
    BROKEN_APP,
    SITE,
    SITE_DIR,
    createStoryHost,
    fixtureIo,
    type StoryHost,
} from "../../../fixtures/htmlApp"

/**
 * The Run tab on the mock host: the states a reviewer cannot click into on a live drive —
 * read-only vs read-write, a bridge rejection and a script error in the strip, a conflict
 * retried, the agent editing a file underneath the app, a sibling-page navigation with the back
 * stack, `not_found` data, `too_large`.
 *
 * The app in the iframe runs on the real stub against the mock host. The driver buttons send what
 * the stub would (`host.handle(FsRequest)`, a nav href, a script error) so each state is one click
 * away, and the strip reacts as it does in the drive.
 */
const meta = {
    title: "@agenta/entity-ui/Drive/HtmlApp/RunView",
    component: RunView,
    parameters: {layout: "padded"},
    tags: ["!autodocs"],
} satisfies Meta<typeof RunView>

export default meta
type Story = StoryObj<typeof meta>

const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="flex h-[440px] w-[760px] flex-col overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer">
        {children}
    </div>
)

let nextId = 1
const req = (method: FsRequest["method"], path: string, body?: string, force?: boolean) =>
    ({v: 1, id: nextId++, method, path, body, force}) as FsRequest

interface DriverAction {
    label: string
    run: (host: StoryHost) => void | Promise<unknown>
}

/** A RunView on a fresh story host, with buttons that stand in for the stub. */
const RunStory = ({
    files,
    dir = APP_DIR,
    entry = "index.html",
    grant = "read",
    actions = [],
    latencyMs,
    failWith,
    seedErrors,
}: {
    files: Record<string, string>
    dir?: string
    entry?: string
    grant?: GrantLevel
    actions?: DriverAction[]
    latencyMs?: number
    failWith?: MockHtmlAppHostOptions["failWith"]
    /** Run once after mount — the story opens already showing the state. */
    seedErrors?: (host: StoryHost) => void
}) => {
    const host = useMemo(() => {
        const h = createStoryHost(files, {grant, dir, latencyMs, failWith})
        seedErrors?.(h)
        return h
        // Fixtures are static per story.
    }, [])
    const io = useMemo(() => fixtureIo(host, dir), [host, dir])
    const [log, setLog] = useState<string[]>([])
    const [changed, setChanged] = useState<string[]>([])
    // What `useChangedHint` does in the drive: the host's `changed` paths feed the pill.
    useEffect(() => host.onChanged?.(setChanged), [host])

    const run = async (action: DriverAction) => {
        const before = host.log.length
        await action.run(host)
        const lines = host.log.slice(before).map((r) => `${r.method} ${r.path}`)
        setLog((prev) => [...prev, `▸ ${action.label}`, ...lines].slice(-8))
    }

    return (
        <div className="flex flex-col gap-3 text-xs">
            <Frame>
                <RunView
                    host={host}
                    dir={dir}
                    entryPath={`${dir}/${entry}`}
                    entryContent={files[entry] ?? ""}
                    grant={grant}
                    io={io}
                    kitCss={KIT_CSS}
                    changedPaths={changed}
                    onReload={() => setChanged([])}
                    onNavigate={(p) => setLog((prev) => [...prev, `→ drive: ${p}`].slice(-8))}
                />
            </Frame>
            {actions.length > 0 ? (
                <div className="flex w-[760px] flex-wrap items-start gap-2">
                    {actions.map((a) => (
                        <button
                            key={a.label}
                            type="button"
                            onClick={() => void run(a)}
                            className="cursor-pointer rounded border border-solid border-colorBorder bg-colorBgContainer px-2 py-1 text-xs text-colorText hover:bg-colorFillTertiary"
                        >
                            {a.label}
                        </button>
                    ))}
                    {log.length > 0 ? (
                        <pre className="m-0 w-full whitespace-pre-wrap rounded bg-colorFillQuaternary p-2 font-mono text-[11px] text-colorTextSecondary">
                            {log.join("\n")}
                        </pre>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

/** Acceptance: a read grant — the strip says `read`, a write is refused with `read_only`. */
export const RunningReadOnly: Story = {
    render: () => (
        <RunStory
            files={BOARD_APP}
            grant="read"
            actions={[
                {label: "Read board.json", run: (h) => h.handle(req("readJSON", "board.json"))},
                {
                    label: "Write board.json (refused)",
                    run: (h) => h.handle(req("writeJSON", "board.json", "{}")),
                },
            ]}
        />
    ),
}

/** Acceptance: a read-write grant — the strip says `read + write`, writes land. */
export const RunningReadWrite: Story = {
    render: () => (
        <RunStory
            files={BOARD_APP}
            grant="read-write"
            actions={[
                {label: "Read board.json", run: (h) => h.handle(req("readJSON", "board.json"))},
                {
                    label: "Write board.json",
                    run: (h) =>
                        h.handle(req("writeJSON", "board.json", '{"columns":[],"cards":[]}')),
                },
                {label: "List app dir", run: (h) => h.handle(req("list", ""))},
            ]}
        />
    ),
}

/** Acceptance: the error strip — a bridge rejection and a script error, expandable, copyable. */
export const ErrorStrip: Story = {
    render: () => (
        <RunStory
            files={BROKEN_APP}
            grant="read"
            seedErrors={(h) => {
                void h.handle(req("write", "notes.txt", "x"))
                h.emitError({
                    kind: "script",
                    message: "Uncaught Error: boom on load",
                    line: 8,
                })
            }}
            actions={[
                {
                    label: "Another bridge rejection (scope)",
                    run: (h) => h.handle(req("read", "../secrets.env")),
                },
                {
                    label: "Another script error",
                    run: (h) =>
                        h.emitError({kind: "script", message: "x is not defined", line: 12}),
                },
            ]}
        />
    ),
}

/** Acceptance: a conflict — the agent edited `board.json` after the app read it; the app's write
 * gets `conflict`, re-reads, and the retry succeeds. */
export const ConflictRetried: Story = {
    render: () => (
        <RunStory
            files={BOARD_APP}
            grant="read-write"
            actions={[
                {
                    label: "1. App reads board.json",
                    run: (h) => h.handle(req("readJSON", "board.json")),
                },
                {
                    label: "Agent writes board.json underneath",
                    run: (h) => h.externalWrite("board.json", '{"columns":[],"cards":[]}'),
                },
                {
                    label: "2. App writes (conflict)",
                    run: (h) => h.handle(req("writeJSON", "board.json", '{"cards":[1]}')),
                },
                {label: "3. App re-reads", run: (h) => h.handle(req("readJSON", "board.json"))},
                {
                    label: "4. App writes again (ok)",
                    run: (h) => h.handle(req("writeJSON", "board.json", '{"cards":[1]}')),
                },
            ]}
        />
    ),
}

/** Acceptance: `changed` hint pending — the drive moved underneath the app; the strip offers
 * Reload, and the mock queues the `changed` message for the iframe. */
export const ChangedHintPending: Story = {
    render: () => (
        <RunStory
            files={BOARD_APP}
            grant="read"
            actions={[
                {
                    label: "Agent writes board.json underneath",
                    run: (h) =>
                        h.externalWrite(
                            "board.json",
                            JSON.stringify({
                                columns: [{id: "new", title: "From the agent"}],
                                cards: [{id: "n1", column: "new", title: "Fresh card"}],
                            }),
                        ),
                },
            ]}
        />
    ),
}

/** Acceptance: navigation inside the app dir — `guide.html` is fetched, assembled and shown with a
 * "‹ back" control; a link outside the dir goes to the drive (logged below). */
export const NavigationBackStack: Story = {
    render: () => (
        <RunStory
            files={SITE}
            dir={SITE_DIR}
            grant="read"
            actions={[
                {label: "App clicks guide.html", run: (h) => h.emitNav("guide.html")},
                {label: "App clicks index.html", run: (h) => h.emitNav("index.html")},
                {label: "App clicks ../notes.md (outside)", run: (h) => h.emitNav("../notes.md")},
                {label: "App clicks #top (ignored)", run: (h) => h.emitNav("#top")},
            ]}
        />
    ),
}

/** Acceptance: `not_found` data — the board without `board.json` shows its own empty state, and
 * the read is reported in the strip. */
export const NotFoundData: Story = {
    render: () => (
        <RunStory
            files={BOARD_APP_NO_DATA}
            grant="read"
            seedErrors={(h) => void h.handle(req("readJSON", "board.json"))}
        />
    ),
}

/** Acceptance: `too_large` — a read over the 4 MB cap. */
export const TooLarge: Story = {
    render: () => (
        <RunStory
            files={BOARD_APP}
            grant="read"
            failWith={{read: "too_large"}}
            seedErrors={(h) => void h.handle(req("read", "board.json"))}
            actions={[{label: "Read again", run: (h) => h.handle(req("read", "board.json"))}]}
        />
    ),
}
