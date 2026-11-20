import {useCallback, useState} from "react"
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentsList from "@agenta/i18n/catalogs/agents.list"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableView} from "@agenta/ui/list-table"

import {AgentCardBody} from "./AgentCardBody"
import type {AgentListGroup, AgentListRow} from "./agentListView"
import {AgentRowCells} from "./AgentRowCells"
import type {AgentRowActions} from "./useAgentRowActions"

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
type Translate = ReturnType<typeof useT<[typeof agentsList]>>

const columnsFor = (narrow: boolean, t: Translate): ListTableColumn[] => {
    const agent: ListTableColumn = {
        key: "agent",
        label: t("agents.list.columnAgent"),
        width: "minmax(160px,2fr)",
    }
    const owner: ListTableColumn = {
        key: "owner",
        label: t("agents.list.columnOwner"),
        width: "minmax(96px,1fr)",
    }
    const lastActive: ListTableColumn = {
        key: "lastActive",
        label: t("agents.list.columnLastActive"),
        width: narrow ? "76px" : "minmax(96px,1fr)",
    }
    const actions: ListTableColumn = {
        key: "actions",
        label: t("agents.list.columnActions"),
        srOnly: true,
        width: "24px",
    }
    return narrow ? [agent, lastActive, actions] : [agent, owner, lastActive, actions]
}

/** Tailwind's `sm`. Below it Created by goes; the minima then fit a 375px screen — 76px is
 * what the "Last active" header needs to stay on one line beside a "15d ago" cell. */
const WIDE_QUERY = "(min-width: 640px)"
const WIDE_MIN_WIDTH = 400
const NARROW_MIN_WIDTH = 300

/**
 * The agents roster in the shared frame — rows or cards over the same groups, in the same frame
 * the sessions and automations lists use.
 *
 * Every row answers what it is, who made it and when it last changed, and the whole row opens the
 * overview because there is nothing else on a row to click. The kebab is the SHARED agent menu,
 * so a row and an agent's own header offer the same verbs.
 */
export const AgentListTable = ({
    groups,
    view,
    isLoading,
    onOpen,
    actions,
    empty,
}: {
    groups: AgentListGroup[]
    view: ListTableView
    isLoading: boolean
    onOpen: (row: AgentListRow) => void
    actions: AgentRowActions
    empty: ReactNode
}) => {
    // Picks the COLUMN SET, not a `display` value: header and body read one array. Asked as
    // "wide?" because the shared hook starts false before it reads the viewport, and a phone
    // is the common case here — the wide-first paint was visible.
    const t = useT(agentsList)
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
            columns={columnsFor(narrow, t)}
            minWidth={narrow ? NARROW_MIN_WIDTH : WIDE_MIN_WIDTH}
            view={view}
            // A card holds three lines of description; narrower than this they wrap to four
            // and the grid reads as a wall of text.
            cardMinWidth={300}
            // The column names stay put while the roster scrolls, as they do on sessions.
            // Affordable for the same reason: the minima fit every width this page is read at,
            // so the frame's own horizontal scroller was never doing anything.
            stickyHeader
            // As drawn (A03): quiet 12 px column names between two lines, 56 px rows with a light
            // line under each, and the cells 8 px in from the table edge.
            headerClassName="border-t border-colorBorderSecondary px-2 text-[12px] font-normal text-colorTextTertiary"
            rowClassName="min-h-14 border-b border-solid border-colorSplit px-5 py-0"
            loading={isLoading}
            groups={groups}
            rowKey={(row) => row.id}
            onOpenRow={onOpen}
            collapsedKeys={collapsed}
            onToggleGroup={toggleGroup}
            empty={empty}
            renderRow={(row) => (
                <AgentRowCells row={row} narrow={narrow} onOpen={onOpen} actions={actions} />
            )}
            renderCard={(row) => <AgentCardBody row={row} onOpen={onOpen} actions={actions} />}
        />
    )
}
