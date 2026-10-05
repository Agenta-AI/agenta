import {useEffect, useRef, useState, type ReactNode} from "react"

import {type ProviderConnection} from "@agenta/entities/secret"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    SkeletonBlock,
    Spinner,
} from "@agenta/ui/ui"
import {ArrowSquareOut, Check, CheckCircle, Copy, WarningCircle} from "@phosphor-icons/react"

import {countdownLabel, useSubscriptionSignIn} from "./useSubscriptionSignIn"

export interface SubscriptionSignInDialogProps {
    open: boolean
    onClose: () => void
    provider?: string
    connection?: ProviderConnection | null
    /** The provider's mark for the header tile. */
    logo?: ReactNode
    /** Remove the connection. Absent hides the verb. */
    onRemove?: (connection: ProviderConnection) => void
}

const CopyCode = ({code}: {code: string}) => {
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
            aria-label="Copy the sign-in code"
            className="group flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-5 transition-colors hover:bg-muted"
        >
            <span className="select-all font-mono text-[26px] font-semibold tracking-[0.25em] text-foreground">
                {code}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
            </span>
        </button>
    )
}

/** A subscription's sign-in in a dialog: opening it starts the device login at once. */
export const SubscriptionSignInDialog = ({
    open,
    onClose,
    provider = "chatgpt",
    connection = null,
    logo,
    onRemove,
}: SubscriptionSignInDialogProps) => {
    const signIn = useSubscriptionSignIn({provider, connection})
    const {name, isReady, pending, starting, error, lostPoll, now, statusLine, connect} = signIn

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
        if (pending) signIn.cancel()
        onClose()
    }

    const succeeded = isReady && !pending && !starting

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        {logo ? (
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-solid border-border bg-background shadow-xs [&_svg]:size-5">
                                {logo}
                            </span>
                        ) : null}
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <DialogTitle>
                                {succeeded ? `${name} connected` : `Connect ${name}`}
                            </DialogTitle>
                            <DialogDescription>
                                {succeeded
                                    ? statusLine || "Agents can run on this subscription."
                                    : `Sign in with your ${name} subscription to run agents on it.`}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {pending ? (
                    <div className="flex flex-col gap-4">
                        <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-muted-foreground">
                            {[
                                `Open ${name} and sign in.`,
                                "Enter this code when it asks for one.",
                            ].map((step, index) => (
                                <li key={step} className="flex items-center gap-2.5">
                                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-solid border-border text-[11px] font-medium text-foreground">
                                        {index + 1}
                                    </span>
                                    {step}
                                </li>
                            ))}
                        </ol>
                        <CopyCode code={pending.userCode} />
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-2">
                                <Spinner size="small" />
                                Waiting for you to sign in
                            </span>
                            {pending.expiresAt ? (
                                <span className="tabular-nums">
                                    Expires in {countdownLabel(pending.expiresAt, now)}
                                </span>
                            ) : null}
                        </div>
                    </div>
                ) : starting ? (
                    <div className="flex flex-col gap-4" aria-busy>
                        <SkeletonBlock active className="h-4 w-2/3 rounded" />
                        <SkeletonBlock active className="h-[74px] w-full rounded-xl" />
                    </div>
                ) : succeeded ? (
                    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-3 text-sm text-colorSuccess">
                        <CheckCircle size={18} weight="fill" />
                        Ready. Pick a {name} model in any agent.
                    </div>
                ) : null}

                {lostPoll && !isReady ? (
                    <p className="m-0 flex items-center gap-1.5 text-xs text-colorWarning">
                        <WarningCircle size={14} />
                        Agenta lost track of that sign-in. Check {name}, then sign in again.
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
                            Remove
                        </Button>
                    ) : null}
                    {pending ? (
                        <>
                            <Button variant="outline" onClick={close}>
                                Cancel
                            </Button>
                            <Button asChild>
                                <a href={pending.verificationUri} target="_blank" rel="noreferrer">
                                    Open {name}
                                    <ArrowSquareOut size={14} />
                                </a>
                            </Button>
                        </>
                    ) : succeeded ? (
                        <>
                            <Button variant="outline" onClick={() => void connect()}>
                                Sign in again
                            </Button>
                            <Button onClick={onClose}>Done</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={close}>
                                Cancel
                            </Button>
                            <Button disabled={starting} onClick={() => void connect()}>
                                {starting ? "Starting…" : "Try again"}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default SubscriptionSignInDialog
