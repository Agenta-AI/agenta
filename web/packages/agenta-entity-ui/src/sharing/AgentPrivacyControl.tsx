import {useState} from "react"

import {useT} from "@agenta/i18n"
import sharingCatalog from "@agenta/i18n/catalogs/entityUi.sharing"
import {personName} from "@agenta/sessions-ui/sharing"
import {LoadingButton} from "@agenta/ui/composed"
import {Button, Popover, PopoverContent, PopoverTrigger, SkeletonBlock} from "@agenta/ui/ui"
import {CaretDownIcon, LockSimpleIcon, UsersIcon, WarningCircleIcon} from "@phosphor-icons/react"

import {AgentPrivacyDialog, type AgentPrivacyProps} from "./AgentPrivacyDialog"
import {agentSharingCopy as copy} from "./copy"
import {useAgentSharingWrites} from "./useAgentSharingWrites"

export type AgentPrivacyControlProps = AgentPrivacyProps & {
    /** The panel opened: the host loads the full state and the members now, not before. */
    onOpen?: () => void
}

/**
 * The agent's "Private" / "Shared" dropdown for the playground top bar. Fixed at 92 px for both
 * values so nothing beside it moves. Someone who is not the owner always sees "Shared".
 */
export const AgentPrivacyControl = (props: AgentPrivacyControlProps) => {
    // The texts come from `copy`; this draws the control again when the language's text loads.
    useT(sharingCatalog)
    const {projectName, sharing, loading = false, loadError = false, onRetry, owner, onOpen} = props
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
            <Popover
                open={panelOpen}
                onOpenChange={(open) => {
                    setPanelOpen(open)
                    if (open) onOpen?.()
                }}
            >
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        data-testid="agent-privacy-trigger"
                        aria-label={
                            shownPrivate
                                ? copy.triggerAriaPrivate
                                : loadError
                                  ? copy.loadError
                                  : undefined
                        }
                        disabled={!sharing && loading}
                        className="w-[92px] shrink-0 justify-between"
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
                        <CaretDownIcon aria-hidden />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="flex w-[300px] flex-col gap-2.5 p-3.5">
                    <span className="text-label font-semibold">{copy.panelTitle}</span>
                    {loadError ? (
                        <>
                            <p className="m-0 text-body">{copy.loadError}</p>
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
                        <p className="m-0 text-body">
                            {shownPrivate ? copy.linePrivate : copy.lineProject(projectName)}
                        </p>
                    )}
                    {known && ownerless && !isOwner ? (
                        // Why the agent has no owner, as the dialog says it (QA D10).
                        <p className="m-0 text-meta text-muted-foreground">
                            {!sharing?.policy.owner_user_id
                                ? copy.noOwner
                                : sharing?.can_take_ownership
                                  ? copy.ownerLeft(
                                        personName(owner) || sharing.policy.owner_user_id,
                                    )
                                  : copy.ownerLeftAskAdmin(
                                        personName(owner) || sharing.policy.owner_user_id,
                                    )}
                        </p>
                    ) : null}
                    {known && owner && !ownerless ? (
                        <span className="text-meta">
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
                        <>
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
                            <span className="text-meta text-muted-foreground">
                                {copy.takeOwnershipHelp}
                            </span>
                        </>
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
