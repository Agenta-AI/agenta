import {useCallback, useState} from "react"
import type {ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"

import type {AgentListGroup, AgentListRow} from "./agentListView"
import {AgentRowCells} from "./AgentRowCells"

/**
 * The columns, shared by the header row and every body row so the two can never drift.
 *
 * Identity takes twice the share of the reading columns; the kebab is fixed at the button's own
 * width so the reading columns keep their proportions.
 *
 * A phone drops Created by rather than scrolling it off. Four columns in 375px left the name a
 * dozen characters, and on a roster this size the creator is the column a reader consults last —
 * the filter menu still asks the question, and Group by → Created by answers it in the headings.
 *
 * Every column reads from its own left edge, header and cells alike: nothing here is a number,
 * and a right-aligned word column has a ragged edge exactly where the eye starts.
 */
const AGENT_COLUMN: ListTableColumn = {
    key: "agent",
    label: "Agent",
    width: "minmax(160px,2fr)",
}
const OWNER_COLUMN: ListTableColumn = {
    key: "owner",
    label: "Created by",
    width: "minmax(96px,1fr)",
}
const lastActiveColumn = (width: string): ListTableColumn => ({
    key: "lastActive",
    label: "Last active",
    width,
})
const ACTIONS_COLUMN: ListTableColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    width: "24px",
}

const WIDE_COLUMNS: ListTableColumn[] = [
    AGENT_COLUMN,
    OWNER_COLUMN,
    lastActiveColumn("96px"),
    ACTIONS_COLUMN,
]
const NARROW_COLUMNS: ListTableColumn[] = [AGENT_COLUMN, lastActiveColumn("76px"), ACTIONS_COLUMN]

/** Tailwind's `sm`. Below it Created by goes; the minima then fit a 375px screen — 76px is
 * what the "Last active" header needs to stay on one line beside a "15d ago" cell. */
const WIDE_QUERY = "(min-width: 640px)"
const WIDE_MIN_WIDTH = 400
const NARROW_MIN_WIDTH = 300

/**
 * The agents roster as a table — the list half of the two views, in the same frame the sessions
 * and automations lists use.
 *
 * Every row answers what it is, who made it and when it last changed, and the whole row opens the
 * overview because there is nothing else on a row to click. The kebab is the SHARED agent menu,
 * so a row and an agent's own header offer the same verbs.
 */
export const AgentListTable = ({
    groups,
    isLoading,
    onOpen,
    empty,
}: {
    groups: AgentListGroup[]
    isLoading: boolean
    onOpen: (row: AgentListRow) => void
    empty: ReactNode
}) => {
    // Picks the COLUMN SET, not a `display` value: header and body read one array. Asked as
    // "wide?" because the shared hook starts false before it reads the viewport, and a phone
    // is the common case here — the wide-first paint was visible.
    const narrow = !useMediaQuery(WIDE_QUERY)

    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    const toggleGroup = useCallback(
        (key: string) =>
            setCollapsed((current) => {
                const next = new Set(current)
                if (!next.delete(key)) next.add(key)
                return next
            }),
        [],
    )

    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? NARROW_MIN_WIDTH : WIDE_MIN_WIDTH}
            // The column names stay put while the roster scrolls, as they do on sessions.
            // Affordable for the same reason: the minima fit every width this page is read at,
            // so the frame's own horizontal scroller was never doing anything.
            stickyHeader
            loading={isLoading}
            groups={groups}
            rowKey={(row) => row.id}
            onOpenRow={onOpen}
            collapsedKeys={collapsed}
            onToggleGroup={toggleGroup}
            empty={empty}
            renderRow={(row) => <AgentRowCells row={row} narrow={narrow} onOpen={onOpen} />}
        />
    )
}
