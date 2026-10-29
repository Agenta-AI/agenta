/**
 * Board starter fixture: the starter files read straight from the API bundle at build time
 * (webpack `?raw` → `asset/source`), assembled with the real kit CSS and bridge stub.
 */
import {BRIDGE_STUB, RUN_CSP} from "@agenta/entities/drive"
import {KIT_CSS} from "@agenta/entity-ui/drive"

import appJson from "../../../api/oss/src/core/apps/starters/board@1/app.json?raw"
import configDefaults from "../../../api/oss/src/core/apps/starters/board@1/config.defaults.json?raw"
import indexHtml from "../../../api/oss/src/core/apps/starters/board@1/index.html?raw"

export const BOARD_STARTER_INDEX_HTML: string = indexHtml
export const BOARD_STARTER_APP_JSON: string = appJson
export const BOARD_STARTER_CONFIG_JSON: string = configDefaults

/** What `create_app("board", dir)` leaves in the folder. */
export const BOARD_STARTER_FILES: Record<string, string> = {
    "index.html": BOARD_STARTER_INDEX_HTML,
    "app.json": BOARD_STARTER_APP_JSON,
    "config.json": BOARD_STARTER_CONFIG_JSON,
}

export const FIVE_CARDS_BOARD = JSON.stringify(
    {
        columns: [
            {
                id: "todo",
                title: "To do",
                cards: [
                    {id: "c1", text: "Write the release notes"},
                    {id: "c2", text: "Ping design about the empty state"},
                ],
            },
            {
                id: "doing",
                title: "Doing",
                cards: [
                    {id: "c3", text: "Wire the conflict path"},
                    {id: "c4", text: "Storybook harness for the board", done: false},
                ],
            },
            {id: "done", title: "Done", cards: [{id: "c5", text: "Manifest parser", done: true}]},
        ],
    },
    null,
    2,
)

/** Kit token sets for the two themes; the host sends one in `hello` and on `theme`. */
export const KIT_TOKENS: Record<"light" | "dark", Record<string, string>> = {
    light: {
        "--ag-bg": "#ffffff",
        "--ag-fg": "#111827",
        "--ag-muted": "#6b7280",
        "--ag-line": "#e5e7eb",
        "--ag-accent": "#4f46e5",
        "--ag-accent-soft": "#eef2ff",
        "--ag-ok": "#16a34a",
        "--ag-warn": "#d97706",
        "--ag-crit": "#dc2626",
        "--ag-font": "system-ui, -apple-system, Segoe UI, sans-serif",
        "--ag-radius": "6px",
    },
    dark: {
        "--ag-bg": "#111827",
        "--ag-fg": "#f3f4f6",
        "--ag-muted": "#9ca3af",
        "--ag-line": "#374151",
        "--ag-accent": "#818cf8",
        "--ag-accent-soft": "#1f2937",
        "--ag-ok": "#4ade80",
        "--ag-warn": "#fbbf24",
        "--ag-crit": "#f87171",
        "--ag-font": "system-ui, -apple-system, Segoe UI, sans-serif",
        "--ag-radius": "6px",
    },
}

/** The document the host would render: CSP, kit, bridge stub, then the app itself. */
export function buildSrcDoc(html: string): string {
    const head =
        `<meta http-equiv="Content-Security-Policy" content="${RUN_CSP}">` +
        `<style>${KIT_CSS}</style>` +
        `<script>${BRIDGE_STUB}</script>`
    const at = html.indexOf("<head>")
    if (at === -1) return head + html
    const cut = at + "<head>".length
    return html.slice(0, cut) + head + html.slice(cut)
}

/** The agent's edit: one more card in the first column of whatever the drive holds now. */
export function boardWithAgentCard(current: string | undefined, configJson: string): string {
    let board: {columns: {id: string; title: string; cards: unknown[]}[]}
    try {
        board = current ? JSON.parse(current) : {columns: []}
    } catch {
        board = {columns: []}
    }
    if (!Array.isArray(board.columns) || board.columns.length === 0) {
        const config = JSON.parse(configJson) as {columns: {id: string; title: string}[]}
        board = {columns: config.columns.map((c) => ({...c, cards: []}))}
    }
    board.columns[0].cards.push({id: `agent-${Date.now()}`, text: "Added by the agent"})
    return JSON.stringify(board, null, 2)
}
