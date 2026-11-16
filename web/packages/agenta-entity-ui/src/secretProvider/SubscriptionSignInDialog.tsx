import {useEffect, useRef, useState, type ReactNode} from "react"

import {subscriptionConnectMethod, type ProviderConnection} from "@agenta/entities/secret"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {ArrowSquareOut, Check, CheckCircle, Copy, WarningCircle} from "@phosphor-icons/react"

import OrganizationProjectsSection, {
    type OrganizationConnectionScope,
} from "./OrganizationProjectsSection"
import {SignInStep} from "./SignInStep"
import {SubscriptionTokenDialog} from "./SubscriptionTokenDialog"
import {useOrganizationProjectsDraft} from "./useOrganizationProjectsDraft"
import {countdownLabel, useSubscriptionSignIn} from "./useSubscriptionSignIn"
import {useT} from "@agenta/i18n"
import subscriptionSignInCatalog from "@agenta/i18n/catalogs/entityUi.subscriptionSignIn"

export interface SubscriptionSignInDialogProps {
    open: boolean
    onClose: () => void
    provider?: string
    connection?: ProviderConnection | null
    /** The provider's mark for the header tile. */
    logo?: ReactNode
    /** Remove the connection. Absent hides the verb. */
    onRemove?: (connection: ProviderConnection) => void
    /**
     * An organization subscription: it signs in on the organization's routes, and the dialog
     * ends with "Projects that can use it", applied on Done.
     */
    organization?: OrganizationConnectionScope
}

const CopyCode = ({code}: {code: string}) => {
    const t = useT(subscriptionSignInCatalog)
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const timer = window.setTimeout(() => setCopied(false), 2000)
        return () => window.clearTimeout(timer)
    }, [copied])
    return (
        <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true))}
            aria-label={t("entityUi.subscriptionSignIn.copySignInCode")}
            className="group flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-5 transition-colors hover:bg-muted"
        >
            <span className="select-all font-mono text-[26px] font-semibold tracking-[0.25em] text-foreground">
                {code}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied
                    ? t("entityUi.subscriptionSignIn.copied")
                    : t("entityUi.subscriptionSignIn.copy")}
            </span>
        </button>
    )
}

/** A device sign-in in a dialog: opening it starts the device login at once. */
const DeviceSignInDialog = ({
    open,
    onClose,
    provider = "chatgpt",
    connection = null,
    logo,
    onRemove,
    organization,
}: SubscriptionSignInDialogProps) => {
    const t = useT(subscriptionSignInCatalog)
    const signIn = useSubscriptionSignIn({
        provider,
        connection,
        scope: organization ? "organization" : "project",
        organizationName: organization?.name,
    })
    const {name, isReady, pending, starting, error, lostPoll, now, statusLine, connect} = signIn
    const draft = useOrganizationProjectsDraft({
        open,
        connection,
        enabled: !!organization && !organization.readOnly,
        organizationName: organization?.name,
    })

    // Opening is the Connect click; a ready connection opens to its status instead.
    const startedRef = useRef(false)
    useEffect(() => {
        if (!open) {
            startedRef.current = false
            return
        }
        if (startedRef.current || isReady) return
        startedRef.current = true
        void connect()
    }, [open, isReady, connect])

    const close = () => {
        // Also ends a sign-in that is still starting.
        signIn.cancel()
        onClose()
    }

    const succeeded = isReady && !pending && !starting
    // The projects of an existing connection save without a sign-in; Done also ends one.
    const saveProjects = draft.changed ? (
        <Button variant="outline" disabled={draft.saving} onClick={() => void draft.apply(close)}>
            {t("entityUi.subscriptionSignIn.done")}
        </Button>
    ) : null
    // A finished sign-in waits on the vault refresh before the connection reads ready.
    const settling = startedRef.current && !pending && !starting && !isReady && !error && !lostPoll

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
            <DialogContent className="sm:max-w-[440px]">
                {/* Same head as the integration connect dialog: the mark, then title and line. */}
                <DialogHeader className="gap-3 text-left">
                    {logo ? (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-solid border-border bg-background shadow-xs [&_svg]:size-[18px]">
                            {logo}
                        </span>
                    ) : null}
                    <div className="flex flex-col gap-1">
                        <DialogTitle className="text-base font-medium leading-snug">
                            {succeeded
                                ? t("entityUi.subscriptionSignIn.nameConnected", {name})
                                : t("entityUi.subscriptionSignIn.connectName", {name})}
                        </DialogTitle>
                        <DialogDescription className="text-sm text-colorTextDescription">
                            {succeeded
                                ? statusLine || t("entityUi.subscriptionSignIn.agentsCanRun")
                                : t("entityUi.subscriptionSignIn.signInWithSubscription", {name})}
                        </DialogDescription>
                    </div>
                </DialogHeader>

                {pending ? (
                    <div className="flex flex-col gap-4">
                        <ol className="m-0 flex list-none flex-col p-0">
                            <SignInStep
                                index={1}
                                title={t("entityUi.subscriptionSignIn.openName", {name})}
                            >
                                <a
                                    href={pending.verificationUri}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex w-fit items-center gap-1 text-[13px] text-btn-link no-underline hover:text-btn-link-hover"
                                >
                                    {pending.verificationUri.replace(/^https?:\/\//, "")}
                                    <ArrowSquareOut size={12} />
                                </a>
                            </SignInStep>
                            <SignInStep
                                index={2}
                                title={t("entityUi.subscriptionSignIn.enterThisCode")}
                                last
                            >
                                <CopyCode code={pending.userCode} />
                            </SignInStep>
                        </ol>
                        <div className="flex items-center justify-between gap-3 text-xs">
                            {/* Shimmers while the poll runs; plain text under reduced motion. */}
                            <span className="bg-[linear-gradient(90deg,var(--ag-colorTextQuaternary)_0%,var(--ag-colorText)_45%,var(--ag-colorTextQuaternary)_90%)] bg-clip-text text-colorTextSecondary motion-safe:animate-text-shimmer motion-safe:bg-[length:240%_100%] motion-safe:text-transparent">
                                {t("entityUi.subscriptionSignIn.waitingForSignIn")}
                            </span>
                            {pending.expiresAt ? (
                                <span className="tabular-nums text-muted-foreground">
                                    {t("entityUi.subscriptionSignIn.expiresIn", {
                                        time: countdownLabel(pending.expiresAt, now),
                                    })}
                                </span>
                            ) : null}
                        </div>
                    </div>
                ) : starting || settling ? (
                    <div className="flex flex-col gap-4" aria-busy>
                        <SkeletonBlock active className="h-4 w-2/3 rounded" />
                        <SkeletonBlock active className="h-[74px] w-full rounded-xl" />
                    </div>
                ) : succeeded ? (
                    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-3 text-sm text-colorSuccess">
                        <CheckCircle size={18} weight="fill" />
                        {t("entityUi.subscriptionSignIn.readyPickModel", {name})}
                    </div>
                ) : null}

                {organization && !organization.readOnly && connection ? (
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

                {lostPoll && !isReady ? (
                    <p className="m-0 flex items-center gap-1.5 text-xs text-colorWarning">
                        <WarningCircle size={14} />
                        {t("entityUi.subscriptionSignIn.lostTrack", {name})}
                    </p>
                ) : null}
                {error ? (
                    <p
                        role="alert"
                        className="m-0 flex items-center gap-1.5 text-xs text-destructive"
                    >
                        <WarningCircle size={14} />
                        {error}
                    </p>
                ) : null}

                <DialogFooter>
                    {succeeded && connection && onRemove ? (
                        <Button
                            variant="ghost"
                            className="mr-auto text-destructive"
                            onClick={() => {
                                onRemove(connection)
                                onClose()
                            }}
                        >
                            {t("entityUi.subscriptionSignIn.remove")}
                        </Button>
                    ) : null}
                    {pending ? (
                        <>
                            <Button variant="outline" onClick={close}>
                                {t("entityUi.subscriptionSignIn.cancel")}
                            </Button>
                            {saveProjects}
                            <Button asChild>
                                <a href={pending.verificationUri} target="_blank" rel="noreferrer">
                                    {t("entityUi.subscriptionSignIn.openName", {name})}
                                    <ArrowSquareOut size={14} />
                                </a>
                            </Button>
                        </>
                    ) : succeeded ? (
                        <>
                            <Button variant="outline" onClick={() => void connect()}>
                                {t("entityUi.subscriptionSignIn.signInAgain")}
                            </Button>
                            <Button
                                disabled={draft.saving}
                                onClick={() => void draft.apply(onClose)}
                            >
                                {t("entityUi.subscriptionSignIn.done")}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={close}>
                                {t("entityUi.subscriptionSignIn.cancel")}
                            </Button>
                            {saveProjects}
                            <Button disabled={starting || settling} onClick={() => void connect()}>
                                {starting
                                    ? t("entityUi.subscriptionSignIn.starting")
                                    : settling
                                      ? t("entityUi.subscriptionSignIn.finishing")
                                      : t("entityUi.subscriptionSignIn.tryAgain")}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** A subscription's connect dialog. The body is chosen here, so a token never mounts a device login. */
export const SubscriptionSignInDialog = (props: SubscriptionSignInDialogProps) =>
    subscriptionConnectMethod(props.provider ?? "chatgpt") === "token" ? (
        <SubscriptionTokenDialog {...props} />
    ) : (
        <DeviceSignInDialog {...props} />
    )

export default SubscriptionSignInDialog
