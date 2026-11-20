import {useMemo} from "react"

import {AgentGlyph} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import sessionsMobileListCatalog from "@agenta/i18n/catalogs/sessions.mobileList"
import {useSessionFilters, type SessionStatusFilter} from "@agenta/sessions/state"
import {FilterMenu, type FilterMenuItem} from "@agenta/ui/filter-menu"
import {
    Archive,
    CalendarBlank,
    ChatCircle,
    Clock,
    Lightning,
    LockSimple,
    Minus,
    Robot,
    Rows,
    SquaresFour,
    Waveform,
} from "@phosphor-icons/react"

import {
    DEFAULT_SESSION_LIST_VIEW,
    isDefaultSessionListView,
    type SessionActivityWindow,
    type SessionGrouping,
    type SessionListView,
} from "./sessionListView"

const ICON = 14

const ALL_AGENTS = "all"

/** The status filters get the dot a row paints, so the filter and the row read alike. */
const StatusDot = ({className}: {className: string}) => (
    <span aria-hidden className={`size-1.5 rounded-full ${className}`} />
)

/**
 * The sessions list's single view control — the same `FilterMenu` the automations list opens, so
 * the two nav entries offer one control rather than a popover on one and a toolbar of switches on
 * the other.
 *
 * Type names the ONE set on screen — Chat or Automation — the way the sidebar's Type facet does.
 * Archived is a switch rather than a third type: it is a lens over either set, and on it shows the
 * archived sessions INSTEAD of the live ones, so the page always answers a single question.
 *
 * No sort row: the server orders sessions by recency everywhere in this app, and a client-side
 * sort would only re-order the pages that happen to have loaded.
 */
export const SessionFilterMenu = ({
    view,
    onChange,
    agents,
    waitingCount,
    onReset,
    lockedAgent,
    defaultView = DEFAULT_SESSION_LIST_VIEW,
}: {
    view: SessionListView
    onChange: (view: SessionListView) => void
    /** The roster the screen already reads, as `{id, name}` in display order. */
    agents: {id: string; name: string}[]
    /** Rides in the Waiting option's label — the menu has no room for a badge. */
    waitingCount?: number
    /**
     * Clears the filters, the grouping AND the search field. The field is a debounced draft the
     * atoms know nothing about, so a reset that only touched the atoms would leave the box
     * showing a term that no longer applies.
     */
    onReset: () => void
    /**
     * The page's one agent, on the Sessions page of an agent. The Agent row shows it with a lock
     * and cannot change, and Group by has no Agent choice.
     */
    lockedAgent?: {id: string; name: string}
    /** What Reset returns to and what counts as untouched. */
    defaultView?: SessionListView
}) => {
    const t = useT(sessionsMobileListCatalog)
    const {agentId, status, mode, archivedOnly, setAgentId, setStatus, setMode, setArchivedOnly} =
        useSessionFilters()

    const sections = useMemo<FilterMenuItem[]>(() => {
        return [
            {
                key: "type",
                label: t("sessions.mobileList.type"),
                // A bolt, not the robot: the robot means AGENT throughout this app, and an
                // automation is a trigger that ran one.
                icon: <Lightning size={ICON} />,
                value: mode ? "automation" : "chat",
                options: [
                    {
                        value: "chat",
                        label: t("sessions.mobileList.chat"),
                        icon: <ChatCircle size={ICON} />,
                    },
                    {
                        value: "automation",
                        label: t("sessions.mobileList.automation"),
                        icon: <Lightning size={ICON} />,
                    },
                ],
                // One list at a time, the way the sidebar's Type facet works. Chat is the default
                // because it is the set a reader means by "my sessions".
                onChange: (value) => setMode(value === "automation"),
            },
            {
                key: "status",
                label: t("sessions.mobileList.status"),
                icon: <Waveform size={ICON} />,
                value: status,
                // Ordered by what it costs to miss, and each dot is the one a row of that status
                // paints. `live` is not offered: "the sandbox is up" is a fact about the
                // infrastructure, and Running answers the question a reader is actually asking.
                options: [
                    {
                        value: "all",
                        label: t("sessions.mobileList.all"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {
                        value: "waiting",
                        label: waitingCount
                            ? t("sessions.mobileList.waitingCount", {count: waitingCount})
                            : t("sessions.mobileList.waiting"),
                        icon: <StatusDot className="bg-[var(--ag-run-status-warning)]" />,
                    },
                    {
                        value: "running",
                        label: t("sessions.mobileList.running"),
                        icon: <StatusDot className="bg-[var(--ag-run-status-success)]" />,
                    },
                    {
                        value: "idle",
                        label: t("sessions.mobileList.idle"),
                        icon: <StatusDot className="bg-[var(--ag-run-status-default)]" />,
                    },
                ],
                onChange: (value) => setStatus(value as SessionStatusFilter),
            },
            lockedAgent
                ? {
                      key: "agent",
                      label: t("sessions.mobileList.agent"),
                      icon: <Robot size={ICON} />,
                      value: lockedAgent.id,
                      valueLabel: lockedAgent.name,
                      options: [
                          {
                              value: lockedAgent.id,
                              label: lockedAgent.name,
                              icon: <LockSimple size={ICON} />,
                              disabled: true,
                          },
                      ],
                      wide: true,
                      onChange: () => undefined,
                  }
                : {
                      key: "agent",
                      label: t("sessions.mobileList.agent"),
                      icon: <Robot size={ICON} />,
                      value: agentId ?? ALL_AGENTS,
                      options: [
                          {
                              value: ALL_AGENTS,
                              label: t("sessions.mobileList.allAgents"),
                              icon: <Robot size={ICON} />,
                          },
                          ...agents.map((agent) => ({
                              value: agent.id,
                              label: agent.name,
                              // The agent's own glyph, as in the table's Agent column.
                              icon: (
                                  <AgentGlyph
                                      workflowId={agent.id}
                                      size={ICON}
                                      fallback={<Robot size={ICON} aria-hidden />}
                                  />
                              ),
                          })),
                      ],
                      emptyText: t("sessions.mobileList.noAgentsYet"),
                      wide: true,
                      onChange: (value) => setAgentId(value === ALL_AGENTS ? null : value),
                  },
            {
                key: "activity",
                label: t("sessions.mobileList.lastActivity"),
                icon: <Clock size={ICON} />,
                value: view.activity,
                options: [
                    {
                        value: "all",
                        label: t("sessions.mobileList.all"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {
                        value: "24h",
                        label: t("sessions.mobileList.today"),
                        icon: <Clock size={ICON} />,
                    },
                    {
                        value: "7d",
                        label: t("sessions.mobileList.last7Days"),
                        icon: <Clock size={ICON} />,
                    },
                    {
                        value: "30d",
                        label: t("sessions.mobileList.last30Days"),
                        icon: <Clock size={ICON} />,
                    },
                ],
                onChange: (value) => onChange({...view, activity: value as SessionActivityWindow}),
            },
            {
                kind: "toggle",
                key: "archived",
                label: t("sessions.mobileList.onlyArchived"),
                icon: <Archive size={ICON} />,
                checked: archivedOnly,
                onChange: setArchivedOnly,
            },
            {
                key: "group",
                label: t("sessions.mobileList.groupBy"),
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                options: [
                    // One agent has nothing to group by.
                    ...(lockedAgent
                        ? []
                        : [
                              {
                                  value: "agent",
                                  label: t("sessions.mobileList.agent"),
                                  icon: <Robot size={ICON} />,
                              },
                          ]),
                    {
                        value: "date",
                        label: t("sessions.mobileList.date"),
                        icon: <CalendarBlank size={ICON} />,
                    },
                    {
                        value: "status",
                        label: t("sessions.mobileList.status"),
                        icon: <Waveform size={ICON} />,
                    },
                    {
                        value: "none",
                        label: t("sessions.mobileList.none"),
                        icon: <Minus size={ICON} />,
                    },
                ],
                onChange: (value) => onChange({...view, group: value as SessionGrouping}),
            },
        ]
    }, [
        agentId,
        agents,
        archivedOnly,
        lockedAgent,
        mode,
        onChange,
        setAgentId,
        setArchivedOnly,
        setMode,
        setStatus,
        status,
        view,
        waitingCount,
        t,
    ])

    // Search is its own field in the toolbar, so it does not dot this button — a control that
    // looks touched because someone typed next to it says nothing about what the menu holds.
    const active =
        Boolean(agentId) ||
        status !== "all" ||
        mode ||
        archivedOnly ||
        !isDefaultSessionListView(view, defaultView)

    return (
        <FilterMenu
            sections={sections}
            align="start"
            // Icon alone: the table beside it is already the subject, and the word "Filter" added
            // a second label to a toolbar that has one.
            label={null}
            triggerAriaLabel={t("sessions.mobileList.filterAndGroup")}
            size="default"
            // The square icon size is 28; the search field is 32.
            triggerClassName="size-8"
            active={active}
            onReset={onReset}
            resetDisabled={!active}
        />
    )
}
