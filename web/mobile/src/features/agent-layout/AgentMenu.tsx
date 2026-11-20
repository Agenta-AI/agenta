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
                {/* The trigger is a div with the button role: the identity renders block
                    elements, which a <button> may not hold. */}
                <BottomSheetMenu
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    title={name}
                    items={entries}
                    trigger={
                        <div
                            role="button"
                            tabIndex={0}
                            aria-haspopup="dialog"
                            className="box-border flex h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-colorText outline-none active:bg-colorFillTertiary focus-visible:bg-colorFillTertiary"
                            onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return
                                event.preventDefault()
                                setSheetOpen(true)
                            }}
                        >
                            <AgentKindBadge workflowId={agentId} editable={false} />
                            <span className="min-w-0 truncate text-base font-semibold leading-5">
                                {name}
                            </span>
                            <CaretDown
                                size={14}
                                aria-hidden
                                className="shrink-0 text-colorTextTertiary"
                            />
                        </div>
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
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        className="h-[30px] min-w-0 gap-2 rounded-[6px] px-2 text-[15px] font-semibold text-colorText"
                    >
                        <span className="truncate">{name}</span>
                        <CaretDown
                            aria-hidden
                            className="size-3.5 shrink-0 text-colorTextTertiary"
                        />
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
