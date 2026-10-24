import {useState} from "react"

import {personName} from "@agenta/sessions-ui/sharing"
import {
    Button,
    LoadingButton,
    Popover,
    PopoverContent,
    PopoverTrigger,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {CaretDownIcon, LockSimpleIcon, UsersIcon, WarningCircleIcon} from "@phosphor-icons/react"

import {AgentPrivacyDialog, type AgentPrivacyProps} from "./AgentPrivacyDialog"
import {agentSharingCopy as copy} from "./copy"
import {useAgentSharingWrites} from "./useAgentSharingWrites"

export type AgentPrivacyControlProps = AgentPrivacyProps

/**
 * The agent's "Private" / "Shared" dropdown for the playground top bar. Fixed at 92 px for both
 * values so nothing beside it moves. Someone who is not the owner always sees "Shared".
 */
export const AgentPrivacyControl = (props: AgentPrivacyControlProps) => {
    const {projectName, sharing, loading = false, loadError = false, onRetry, owner} = props
    const [panelOpen, setPanelOpen] = useState(false)
    const [dialogOpen, setDialogOpen] = useState(false)
    const writes = useAgentSharingWrites(props)

    // Visibility is known only after a read answered and the last read did not fail. Until then
    // the panel never claims the project can see the agent.
    const known = Boolean(sharing) && !loadError
    const isOwner = known && sharing?.my_role === "owner"
    const shownPrivate = isOwner && sharing?.policy.visibility === "private"
    const ownerless = !sharing?.policy.owner_user_id || sharing?.owner_is_active === false

    return (
        <>
            <Popover open={panelOpen} onOpenChange={setPanelOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        data-testid="agent-privacy-trigger"
                        aria-label={
                            shownPrivate
                                ? copy.triggerAriaPrivate
                                : loadError
                                  ? copy.loadError
                                  : undefined
                        }
                        disabled={!sharing && loading}
                        className="box-border flex h-6 w-[92px] shrink-0 cursor-pointer items-center justify-between gap-1 rounded-control-sm border border-solid border-border bg-background pl-2 pr-1.5 text-xs text-foreground [font-family:inherit] hover:bg-accent disabled:cursor-default"
                    >
                        {loadError ? (
                            <WarningCircleIcon size={12} aria-hidden />
                        ) : sharing ? (
                            <span className="flex items-center gap-1.5">
                                {shownPrivate ? (
                                    <LockSimpleIcon size={12} aria-hidden />
                                ) : (
                                    <UsersIcon size={12} aria-hidden />
                                )}
                                {shownPrivate ? copy.triggerPrivate : copy.triggerShared}
                            </span>
                        ) : (
                            <SkeletonBlock className="h-3 w-12" />
                        )}
                        <CaretDownIcon size={11} aria-hidden />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="flex w-[300px] flex-col gap-2.5 p-3.5">
                    <span className="text-sm font-semibold">{copy.panelTitle}</span>
                    {loadError ? (
                        <>
                            <p className="m-0 text-sm">{copy.loadError}</p>
                            {onRetry ? (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="self-start"
                                    onClick={onRetry}
                                >
                                    {copy.retry}
                                </Button>
                            ) : null}
                        </>
                    ) : !known ? (
                        <SkeletonBlock className="h-4 w-full" />
                    ) : (
                        <p className="m-0 text-sm">
                            {shownPrivate ? copy.linePrivate : copy.lineProject(projectName)}
                        </p>
                    )}
                    {known && owner && !ownerless ? (
                        <span className="text-xs">
                            {isOwner ? copy.panelOwnerYou(personName(owner)) : personName(owner)}
                            {isOwner ? null : (
                                <span className="text-muted-foreground"> · {copy.ownerRole}</span>
                            )}
                        </span>
                    ) : null}
                    {isOwner ? (
                        <Button
                            size="sm"
                            variant="outline"
                            className="self-start"
                            onClick={() => {
                                setPanelOpen(false)
                                setDialogOpen(true)
                            }}
                        >
                            {copy.change}
                        </Button>
                    ) : known && ownerless && sharing?.can_take_ownership ? (
                        <LoadingButton
                            size="sm"
                            className="self-start"
                            loading={writes.saving === "take"}
                            onClick={() => {
                                void writes.takeOwnership().then((ok) => {
                                    if (!ok) {
                                        setPanelOpen(false)
                                        setDialogOpen(true)
                                    }
                                })
                            }}
                        >
                            {copy.takeOwnership}
                        </LoadingButton>
                    ) : null}
                </PopoverContent>
            </Popover>
            <AgentPrivacyDialog
                {...props}
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                writes={writes}
            />
        </>
    )
}
