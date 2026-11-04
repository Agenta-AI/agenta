import {personName} from "@agenta/sessions-ui/sharing"
import {Button, IconTile, LoadingButton, SkeletonBlock} from "@agenta/ui/ui"
import {LockSimpleIcon, UsersIcon} from "@phosphor-icons/react"

import type {AgentPrivacyProps, AgentSharingWrites} from "./AgentPrivacyDialog"
import {agentSharingCopy as copy} from "./copy"

export type AgentPrivacySummaryProps = Pick<
    AgentPrivacyProps,
    "projectName" | "sharing" | "loadError" | "onRetry" | "owner"
> & {
    writes: AgentSharingWrites
    /** Open the privacy dialog. It lives with the host, because this panel closes first. */
    onChange: () => void
    /** `row` is one line with the action beside it. States that need explaining stay stacked. */
    layout?: "stack" | "row"
}

/** Who can use the agent, who owns it, and the one action the reader has: the panel's body. */
export const AgentPrivacySummary = ({
    projectName,
    sharing,
    loadError = false,
    onRetry,
    owner,
    writes,
    onChange,
    layout = "stack",
}: AgentPrivacySummaryProps) => {
    // Visibility is known only after a read answered and the last read did not fail. Until then
    // the panel never claims the project can see the agent.
    const known = Boolean(sharing) && !loadError
    const isOwner = known && sharing?.my_role === "owner"
    const shownPrivate = isOwner && sharing?.policy.visibility === "private"
    const ownerless = !sharing?.policy.owner_user_id || sharing?.owner_is_active === false

    if (layout === "row" && known && (isOwner || !ownerless)) {
        return (
            <div className="flex items-center gap-2.5">
                <IconTile tone="muted" aria-hidden>
                    {shownPrivate ? <LockSimpleIcon /> : <UsersIcon />}
                </IconTile>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13px] font-medium">
                        {shownPrivate ? copy.triggerPrivate : copy.triggerShared}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {shownPrivate ? copy.linePrivate : copy.rowProject(projectName)}
                    </span>
                    {!isOwner && owner ? (
                        <span className="text-xs text-muted-foreground">
                            {personName(owner)} · {copy.ownerRole}
                        </span>
                    ) : null}
                </span>
                {isOwner ? (
                    <Button size="sm" variant="outline" onClick={onChange}>
                        {copy.change}
                    </Button>
                ) : null}
            </div>
        )
    }

    return (
        <>
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
            {known && ownerless && !isOwner ? (
                // Why the agent has no owner, as the dialog says it (QA D10).
                <p className="m-0 text-xs text-muted-foreground">
                    {!sharing?.policy.owner_user_id
                        ? copy.noOwner
                        : sharing?.can_take_ownership
                          ? copy.ownerLeft(personName(owner) || sharing.policy.owner_user_id)
                          : `${copy.ownerLeft(
                                personName(owner) || sharing.policy.owner_user_id,
                            )} ${copy.ownerLeftNonAdmin}`}
                </p>
            ) : null}
            {known && owner && !ownerless ? (
                <span className="text-xs">
                    {isOwner ? copy.panelOwnerYou(personName(owner)) : personName(owner)}
                    {isOwner ? null : (
                        <span className="text-muted-foreground"> · {copy.ownerRole}</span>
                    )}
                </span>
            ) : null}
            {isOwner ? (
                <Button size="sm" variant="outline" className="self-start" onClick={onChange}>
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
                                if (!ok) onChange()
                            })
                        }}
                    >
                        {copy.takeOwnership}
                    </LoadingButton>
                    <span className="text-xs text-muted-foreground">{copy.takeOwnershipHelp}</span>
                </>
            ) : null}
        </>
    )
}
