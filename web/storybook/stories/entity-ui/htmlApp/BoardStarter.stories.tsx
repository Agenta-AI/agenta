import {useEffect, useRef, useState} from "react"

import {
    createMockHtmlAppHost,
    SANDBOX_FLAGS,
    type GrantLevel,
    type MockHtmlAppHost,
} from "@agenta/entities/drive"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    BOARD_STARTER_FILES,
    FIVE_CARDS_BOARD,
    KIT_TOKENS,
    boardWithAgentCard,
    buildSrcDoc,
} from "../../../fixtures/boardStarter"

// The board starter (api/oss/src/core/apps/starters/board@1) running against the mock host in
// a sandboxed iframe. Lane C's RunView is not in this branch, so the harness below is the
// minimal iframe host: it builds the srcDoc (CSP + story kit + story stub + index.html),
// attaches the mock on load, and offers the two agent edits a reviewer cannot otherwise
// trigger: an announced one (`externalWrite`, which also sends `changed`) and a silent one
// (`files.set`, which leaves the app's cached etag stale so its next write conflicts).

type AgentEdit = "announced" | "silent"

interface HarnessProps {
    files: Record<string, string>
    grant: GrantLevel
    dark: boolean
    /** Fire this agent edit automatically, once, after the app has booted. */
    autoEdit?: AgentEdit
    autoEditDelayMs?: number
}

const themeOf = (dark: boolean) => (dark ? "dark" : "light")

function BoardHarness({files, grant, dark, autoEdit, autoEditDelayMs = 1500}: HarnessProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const [host] = useState<MockHtmlAppHost>(() =>
        createMockHtmlAppHost(files, {grant, tokens: KIT_TOKENS[themeOf(dark)]}),
    )
    const [srcDoc] = useState(() => buildSrcDoc(files["index.html"]))
    const [events, setEvents] = useState<string[]>([])
    const note = (line: string) => setEvents((prev) => [...prev.slice(-7), line])

    useEffect(() => {
        const off = host.onError((e) => note(`${e.kind} error: ${e.message}`))
        return () => {
            off()
            host.detach()
        }
        // The host is created once per story mount; a new story id remounts the tree.
    }, [host])

    useEffect(() => {
        host.setTheme(KIT_TOKENS[themeOf(dark)])
    }, [host, dark])

    const edit = (mode: AgentEdit) => {
        const next = boardWithAgentCard(host.files.get("board.json"), files["config.json"])
        if (mode === "announced") {
            host.externalWrite("board.json", next)
            note("agent wrote board.json and the app was told (changed)")
        } else {
            host.files.set("board.json", next)
            note("agent wrote board.json silently: the app's next save will conflict")
        }
    }

    useEffect(() => {
        if (!autoEdit) return
        const timer = setTimeout(() => edit(autoEdit), autoEditDelayMs)
        return () => clearTimeout(timer)
    }, [autoEdit, autoEditDelayMs])

    return (
        <div className="flex flex-col gap-2" style={{height: 560}}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded border px-2 py-0.5">grant: {grant}</span>
                <button
                    type="button"
                    className="rounded border px-2 py-0.5"
                    onClick={() => edit("announced")}
                >
                    Agent edits board.json (announced)
                </button>
                <button
                    type="button"
                    className="rounded border px-2 py-0.5"
                    onClick={() => edit("silent")}
                >
                    Agent edits board.json (silent, next drop conflicts)
                </button>
                <button
                    type="button"
                    className="rounded border px-2 py-0.5"
                    onClick={() => host.setVisible(false)}
                >
                    Hide
                </button>
                <button
                    type="button"
                    className="rounded border px-2 py-0.5"
                    onClick={() => host.setVisible(true)}
                >
                    Show
                </button>
            </div>
            <iframe
                ref={iframeRef}
                title="Board starter"
                sandbox={SANDBOX_FLAGS}
                srcDoc={srcDoc}
                className="w-full flex-1 rounded border"
                onLoad={(e) => host.attach(e.currentTarget)}
            />
            <pre className="m-0 max-h-24 overflow-auto rounded border p-2 text-[11px]">
                {events.length ? events.join("\n") : "host log"}
            </pre>
        </div>
    )
}

const withBoard = (board?: string): Record<string, string> =>
    board ? {...BOARD_STARTER_FILES, "board.json": board} : {...BOARD_STARTER_FILES}

const meta = {
    title: "@agenta/entity-ui/Drive/HtmlApp/BoardStarter",
    component: BoardHarness,
    parameters: {layout: "padded"},
    tags: ["!autodocs"],
    args: {files: withBoard(), grant: "read-write", dark: false},
    render: (args, {globals}) => <BoardHarness {...args} dark={globals.theme === "dark"} />,
} satisfies Meta<typeof BoardHarness>

export default meta
type Story = StoryObj<typeof meta>

/** No board.json yet: the app treats not_found as empty columns from config.json. */
export const EmptyBoard: Story = {}

export const FiveCards: Story = {
    args: {files: withBoard(FIVE_CARDS_BOARD)},
}

/** A `read` grant: moves and edits stay local, marked unsaved, with the toolbar note. */
export const ReadOnlyGrant: Story = {
    args: {files: withBoard(FIVE_CARDS_BOARD), grant: "read"},
}

/**
 * The agent writes board.json silently 1.5 s after boot. The next drop conflicts (412),
 * the app re-reads, merges (union of cards, our positions) and saves once: "Merged and saved".
 */
export const ConflictOnDrop: Story = {
    args: {files: withBoard(FIVE_CARDS_BOARD), autoEdit: "silent"},
}

/** The agent writes board.json and `changed` arrives: the app re-reads while no drag is on. */
export const ChangedArrival: Story = {
    args: {files: withBoard(FIVE_CARDS_BOARD), autoEdit: "announced"},
}

/** Dark tokens through the theme global; the toolbar toggle re-themes the running app. */
export const DarkTheme: Story = {
    args: {files: withBoard(FIVE_CARDS_BOARD)},
    globals: {theme: "dark"},
}
