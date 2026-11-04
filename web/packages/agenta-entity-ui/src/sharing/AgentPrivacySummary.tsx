import {personName} from "@agenta/sessions-ui/sharing"
import {Button, LoadingButton, SkeletonBlock} from "@agenta/ui/ui"

import type {AgentPrivacyProps, AgentSharingWrites} from "./AgentPrivacyDialog"
import {agentSharingCopy as copy} from "./copy"

export type AgentPrivacySummaryProps = Pick<
    AgentPrivacyProps,
    "projectName" | "sharing" | "loadError" | "onRetry" | "owner"
> & {
    writes: AgentSharingWrites
    /** Open the privacy dialog. It lives with the host, because this panel closes first. */
    onChange: () => void
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
}: AgentPrivacySummaryProps) => {
    // Visibility is known only after a read answered and the last read did not fail. Until then
    // the panel never claims the project can see the agent.
    const known = Boolean(sharing) && !loadError
    const isOwner = known && sharing?.my_role === "owner"
    const shownPrivate = isOwner && sharing?.policy.visibility === "private"
    const ownerless = !sharing?.policy.owner_user_id || sharing?.owner_is_active === false

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
