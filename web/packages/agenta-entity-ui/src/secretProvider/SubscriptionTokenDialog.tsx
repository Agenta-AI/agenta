import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Spinner,
} from "@agenta/ui/ui"
import {CheckCircle, WarningCircle} from "@phosphor-icons/react"

import OrganizationProjectsSection from "./OrganizationProjectsSection"
import type {SubscriptionSignInDialogProps} from "./SubscriptionSignInDialog"
import {SubscriptionTokenSteps} from "./SubscriptionTokenSteps"
import {useOrganizationProjectsDraft} from "./useOrganizationProjectsDraft"
import {useSubscriptionToken} from "./useSubscriptionToken"

/** A subscription connected by a pasted token. Opening it starts nothing. */
export const SubscriptionTokenDialog = ({
    open,
    onClose,
    provider = "claude",
    connection = null,
    logo,
    onRemove,
    organization,
}: SubscriptionSignInDialogProps) => {
    const draft = useOrganizationProjectsDraft({
        open,
        connection,
        enabled: !!organization && !organization.readOnly,
    })
    // A pasted token creates the connection, so the projects chosen before Connect go with it.
    const token = useSubscriptionToken({
        provider,
        connection,
        scope: organization ? "organization" : "project",
        projects: organization ? draft.projects : undefined,
    })
    const {name, connected} = token

    // A check in flight cannot be stopped, so the dialog stays until it answers.
    const close = () => {
        if (token.checking) return
        token.reset()
        onClose()
    }

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader className="gap-3 text-left">
                    {logo ? (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-solid border-border bg-background shadow-xs [&_svg]:size-[18px]">
                            {logo}
                        </span>
                    ) : null}
                    <div className="flex flex-col gap-1">
                        <DialogTitle className="text-base font-medium leading-snug">
                            {connected ? `${name} connected` : `Connect ${name}`}
                        </DialogTitle>
                        <DialogDescription className="text-sm text-colorTextDescription">
                            {connected
                                ? "Agents can run on this subscription."
                                : `Run agents on your ${name} Pro or Max plan. Agents use it through Claude Code.`}
                        </DialogDescription>
                    </div>
                </DialogHeader>

                {connected ? (
                    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-3 text-sm text-colorSuccess">
                        <CheckCircle size={18} weight="fill" />
                        Ready. Pick a {name} model in any agent.
                    </div>
                ) : (
                    <SubscriptionTokenSteps token={token} />
                )}

                {organization && !organization.readOnly ? (
                    <div className="text-xs">
                        <OrganizationProjectsSection
                            scope={organization}
                            value={draft.projects}
                            onChange={draft.setProjects}
                            saved={draft.saved}
                        />
                    </div>
                ) : null}
                {draft.error ? (
                    <p
                        role="alert"
                        className="m-0 flex items-center gap-1.5 text-xs text-destructive"
                    >
                        <WarningCircle size={14} />
                        {draft.error}
                    </p>
                ) : null}

                <DialogFooter>
                    {connected ? (
                        <>
                            {connection && onRemove ? (
                                <Button
                                    variant="ghost"
                                    className="mr-auto text-destructive"
                                    onClick={() => {
                                        onRemove(connection)
                                        close()
                                    }}
                                >
                                    Remove
                                </Button>
                            ) : null}
                            <Button variant="outline" onClick={token.replace}>
                                Replace token
                            </Button>
                            <Button disabled={draft.saving} onClick={() => void draft.apply(close)}>
                                Done
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" disabled={token.checking} onClick={close}>
                                Cancel
                            </Button>
                            <Button disabled={!token.canSubmit} onClick={() => void token.submit()}>
                                {token.checking ? (
                                    <>
                                        <Spinner className="size-3.5" />
                                        Checking…
                                    </>
                                ) : (
                                    "Connect"
                                )}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default SubscriptionTokenDialog
