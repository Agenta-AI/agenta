// The ChatGPT subscription card: a connection whose credential is a sign-in, so one verb per state
// and no form. Design: docs/design/hosted-subscription-connections/implementation-contract.md §4.
import {useCallback, useEffect, useState} from "react"

import {type ProviderConnection} from "@agenta/entities/secret"
import {Button} from "@agenta/ui/ui"
import {ArrowSquareOut, Check, Copy, WarningCircle} from "@phosphor-icons/react"

import {countdownLabel, useSubscriptionSignIn} from "./useSubscriptionSignIn"

export interface SubscriptionConnectionCardProps {
    /** The product family. `chatgpt` is the only one today. */
    provider?: string
    /** The stored connection, when the project already has one. */
    connection?: ProviderConnection | null
    /** Remove the connection. Absent hides the verb rather than letting it go dead. */
    onRemove?: (connection: ProviderConnection) => void
}

const CodeBlock = ({code}: {code: string}) => {
    const [copied, setCopied] = useState(false)

    const copy = useCallback(() => {
        void navigator.clipboard?.writeText(code).then(() => setCopied(true))
    }, [code])

    useEffect(() => {
        if (!copied) return
        const timer = window.setTimeout(() => setCopied(false), 2000)
        return () => window.clearTimeout(timer)
    }, [copied])

    return (
        <div className="flex items-center gap-2">
            <span className="select-all font-mono text-lg tracking-[0.2em] text-colorText">
                {code}
            </span>
            <Button size="sm" variant="ghost" onClick={copy} aria-label="Copy the sign-in code">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
            </Button>
        </div>
    )
}

const SubscriptionConnectionCard = ({
    provider = "chatgpt",
    connection = null,
    onRemove,
}: SubscriptionConnectionCardProps) => {
    const {
        name,
        isReady,
        hasSignedInBefore,
        pending,
        starting,
        error,
        lostPoll,
        now,
        statusLine,
        connect,
        cancel,
    } = useSubscriptionSignIn({provider, connection})

    return (
        <section className="flex flex-col gap-3 rounded-md border border-solid border-colorBorderSecondary p-4 text-xs">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-colorText">{name}</span>
                    <span
                        className={
                            isReady && !pending
                                ? "flex items-center gap-1.5 text-colorSuccess"
                                : "text-colorTextSecondary"
                        }
                    >
                        {isReady && !pending ? (
                            <span
                                aria-hidden
                                className="size-1.5 shrink-0 rounded-full bg-colorSuccess"
                            />
                        ) : null}
                        {statusLine || "Sign in with your ChatGPT subscription to run agents."}
                    </span>
                </div>

                {pending ? null : (
                    <div className="flex shrink-0 items-center gap-2">
                        <Button size="sm" disabled={starting} onClick={() => void connect()}>
                            {hasSignedInBefore ? "Sign in again" : `Connect ${name}`}
                        </Button>
                        {connection && onRemove ? (
                            <Button size="sm" variant="ghost" onClick={() => onRemove(connection)}>
                                Remove
                            </Button>
                        ) : null}
                    </div>
                )}
            </div>

            {pending ? (
                <div className="flex flex-col gap-3 rounded-md bg-colorFillQuaternary p-3">
                    <span className="text-colorTextSecondary">
                        Open ChatGPT and enter this code. Keep this page open.
                    </span>
                    <CodeBlock code={pending.userCode} />
                    <div className="flex flex-wrap items-center gap-2">
                        <a
                            href={pending.verificationUri}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-btn-link hover:text-btn-link-hover"
                        >
                            Open ChatGPT
                            <ArrowSquareOut size={12} />
                        </a>
                        {pending.expiresAt ? (
                            <span className="text-colorTextTertiary">
                                Expires in {countdownLabel(pending.expiresAt, now)}
                            </span>
                        ) : null}
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={cancel}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}

            {lostPoll && !isReady ? (
                <span className="flex items-center gap-1 text-colorWarning">
                    <WarningCircle size={14} />
                    Agenta lost track of that sign-in. Check ChatGPT, then sign in again.
                </span>
            ) : null}

            {error ? (
                <span className="flex items-center gap-1 text-colorError">
                    <WarningCircle size={14} />
                    {error}
                </span>
            ) : null}
        </section>
    )
}

export default SubscriptionConnectionCard
