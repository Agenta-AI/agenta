import {useState, type ReactNode} from "react"

import {SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {AgentIdentity, useAgentActions} from "@agenta/entity-ui/agent"
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
} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {useProjectPermission} from "../context/useProjectPermission"
import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"

import {LeaveWhenArchived} from "./LeaveWhenArchived"

interface AgentMenuEntry {
    key: string
    label: ReactNode
    disabled?: boolean
    onSelect: () => void
}

/**
 * The agent menu of the session header: History, Rename, Export agent, Archive agent. On a phone
 * the agent's icon and name are the trigger, and the menu opens as a bottom sheet with "Cancel".
 */
export const AgentMenu = ({
    agentId,
    name,
    sessionId,
    canSend,
    projectId,
    base,
    phone = false,
}: {
    agentId: string
    name: string
    sessionId: string
    canSend: boolean
    projectId: string
    /** The project URL: an archived agent leaves for its Agents list. */
    base: string
    phone?: boolean
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
            onSelect: () => openHistory(agentId),
        },
        ...(canEdit
            ? [
                  {
                      key: "rename",
                      label: t("agentLayout.header.rename"),
                      onSelect: () => actions.rename(target),
                  },
              ]
            : []),
        ...(canSend
            ? [
                  {
                      key: "export",
                      label: t("agentLayout.header.exportAgent"),
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
                {/* A div with the button role: the identity renders block elements, which a
                    <button> may not hold. */}
                <div
                    role="button"
                    tabIndex={0}
                    aria-haspopup="dialog"
                    className="box-border flex h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-colorText outline-none active:bg-colorFillTertiary focus-visible:bg-colorFillTertiary"
                    onClick={() => setSheetOpen(true)}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return
                        event.preventDefault()
                        setSheetOpen(true)
                    }}
                >
                    <AgentIdentity workflowId={agentId} name={name} editable={false} />
                    <CaretDown size={14} aria-hidden className="shrink-0 text-colorTextSecondary" />
                </div>
                <BottomSheetMenu
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    title={name}
                    items={entries}
                />
            </>
        )
    }
    return (
        <>
            {leave}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={name} className="shrink-0">
                        <CaretDown size={12} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                    {entries.map((entry) => (
                        <DropdownMenuItem
                            key={entry.key}
                            disabled={entry.disabled}
                            onSelect={entry.onSelect}
                        >
                            {entry.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    )
}
