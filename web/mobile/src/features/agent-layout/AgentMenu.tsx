import {useState, type ReactNode} from "react"

import {SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {AgentKindBadge, useAgentActions} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import {openAgentVersionHistoryAtom} from "@agenta/playground-ui/agent-version-history"
import {BottomSheetMenu} from "@agenta/ui/phone"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {
    Archive,
    CaretDown,
    ClockCounterClockwise,
    DownloadSimple,
    PencilSimple,
} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {useProjectPermission} from "../context/useProjectPermission"
import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"

import {LeaveWhenArchived} from "./LeaveWhenArchived"

export interface AgentMenuEntry {
    key: string
    label: ReactNode
    /** Each menu sizes it: 16 px in the desktop menu, 18 px in the phone sheet. */
    icon: ReactNode
    disabled?: boolean
    onSelect: () => void
}

/**
 * The agent menu of the session header: History, Rename, Export agent, Archive agent. The agent's
 * name and a down arrow are the trigger, after the agent's icon. On a phone the icon is part of the
 * trigger, and the menu opens as a bottom sheet with "Cancel".
 */
export const AgentMenu = ({
    agentId,
    name,
    sessionId,
    canSend,
    projectId,
    base,
    phone = false,
    phoneTrigger,
    leadingEntries = [],
}: {
    agentId: string
    name: string
    sessionId: string
    canSend: boolean
    projectId: string
    /** The project URL: an archived agent leaves for its Agents list. */
    base: string
    phone?: boolean
    /** Replaces the phone trigger (the name), so the sheet can open from a More button. */
    phoneTrigger?: ReactNode
    /** Entries before the agent's own ones in the phone sheet. */
    leadingEntries?: AgentMenuEntry[]
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    const canEdit = useProjectPermission(projectId, "edit_workflows")
    const actions = useAgentActions()
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    const store = useStore()
    const pending = useAtomValue(pendingTasksAtom)[sessionId] !== undefined
    const target = {id: agentId, name}
    // Set when the person picks Archive. The confirmation and the request belong to the shared
    // agent actions, so the menu learns the result from the agent list.
    const [archiveAskedFor, setArchiveAskedFor] = useState<string | null>(null)
    const [sheetOpen, setSheetOpen] = useState(false)
    const entries: AgentMenuEntry[] = [
        {
            key: "history",
            label: t("agentLayout.header.history"),
            icon: <ClockCounterClockwise />,
            onSelect: () => openHistory(agentId),
        },
        ...(canEdit
            ? [
                  {
                      key: "rename",
                      label: t("agentLayout.header.rename"),
                      icon: <PencilSimple />,
                      onSelect: () => actions.rename(target),
                  },
              ]
            : []),
        ...(canSend
            ? [
                  {
                      key: "export",
                      label: t("agentLayout.header.exportAgent"),
                      icon: <DownloadSimple />,
                      disabled: pending,
                      onSelect: () => {
                          // Production "Save as template": the agent builds the download.
                          if (store.get(pendingTasksAtom)[sessionId]) return
                          store.set(stashPendingTaskAtom, {
                              sessionId,
                              task: {agentId, text: SAVE_AS_TEMPLATE_MESSAGE},
                          })
                      },
                  },
              ]
            : []),
        ...(canEdit
            ? [
                  {
                      key: "archive",
                      label: t("agentLayout.header.archiveAgent"),
                      icon: <Archive />,
                      onSelect: () => {
                          setArchiveAskedFor(agentId)
                          actions.remove(target)
                      },
                  },
              ]
            : []),
    ]
    const leave =
        archiveAskedFor === agentId ? <LeaveWhenArchived agentId={agentId} base={base} /> : null
    if (phone) {
        return (
            <>
                {leave}
                {/* The trigger is a div with the button role: the identity renders block
                    elements, which a <button> may not hold. It starts 4 px after the menu
                    button; the header row's gap is 2 px (M01). */}
                <BottomSheetMenu
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    title={name}
                    items={[...leadingEntries, ...entries]}
                    trigger={
                        phoneTrigger ?? (
                            <div
                                role="button"
                                tabIndex={0}
                                aria-haspopup="dialog"
                                className=" ml-0.5 box-border flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-foreground outline-none active:bg-secondary focus-visible:bg-secondary"
                                onKeyDown={(event) => {
                                    if (event.key !== "Enter" && event.key !== " ") return
                                    event.preventDefault()
                                    setSheetOpen(true)
                                }}
                            >
                                <AgentKindBadge workflowId={agentId} editable={false} />
                                <span className="min-w-0 truncate text-label">{name}</span>
                                <CaretDown
                                    size={14}
                                    aria-hidden
                                    className="shrink-0 text-muted-foreground"
                                />
                            </div>
                        )
                    }
                />
            </>
        )
    }
    return (
        <>
            {leave}
            {/* The icon (it opens the icon picker), then the name and the arrow as one button. */}
            <AgentKindBadge workflowId={agentId} />
            <DropdownMenu>
                {/* The full name on hover: a narrow column cuts it first. */}
                <SimpleTooltip title={name}>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="min-w-0 shrink gap-1.5 px-2 text-foreground"
                        >
                            <span className="truncate">{name}</span>
                            <CaretDown
                                aria-hidden
                                className="ag-caret size-3.5 shrink-0 text-muted-foreground"
                            />
                        </Button>
                    </DropdownMenuTrigger>
                </SimpleTooltip>
                <DropdownMenuContent align="start" className="w-52">
                    {entries.map((entry) => (
                        <DropdownMenuItem
                            key={entry.key}
                            disabled={entry.disabled}
                            onSelect={entry.onSelect}
                        >
                            {entry.icon}
                            {entry.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    )
}
