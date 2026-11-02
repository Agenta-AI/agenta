// A subscription connected by a pasted token, as a drawer card: the steps open in place.
import {useEffect, useState} from "react"

import {type ProviderConnection} from "@agenta/entities/secret"
import {Button, Spinner} from "@agenta/ui/ui"

import {SubscriptionTokenSteps} from "./SubscriptionTokenSteps"
import {useSubscriptionToken} from "./useSubscriptionToken"

export interface SubscriptionTokenCardProps {
    provider?: string
    /** The stored connection, when the project already has one. */
    connection?: ProviderConnection | null
}

const SubscriptionTokenCard = ({
    provider = "claude",
    connection = null,
}: SubscriptionTokenCardProps) => {
    const token = useSubscriptionToken({provider, connection})
    const {name, connected} = token
    const [open, setOpen] = useState(false)

    // A stored token closes the steps.
    useEffect(() => {
        if (connected) setOpen(false)
    }, [connected])

    const showSteps = open && !connected

    return (
        <section className="flex flex-col gap-3 rounded-md border border-solid border-colorBorderSecondary p-4 text-xs">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-colorText">{name}</span>
                    {connected ? (
                        <span className="flex items-center gap-1.5 text-colorSuccess">
                            <span
                                aria-hidden
                                className="size-1.5 shrink-0 rounded-full bg-colorSuccess"
                            />
                            Connected
                        </span>
                    ) : (
                        <span className="text-colorTextSecondary">
                            Paste a token to run agents on your Pro or Max plan.
                        </span>
                    )}
                </div>

                {showSteps ? null : connected ? (
                    <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => {
                            token.replace()
                            setOpen(true)
                        }}
                    >
                        Replace token
                    </Button>
                ) : (
                    <Button size="sm" className="shrink-0" onClick={() => setOpen(true)}>
                        Connect {name}
                    </Button>
                )}
            </div>

            {showSteps ? (
                <div className="flex flex-col gap-3 rounded-md bg-colorFillQuaternary p-3">
                    <SubscriptionTokenSteps token={token} />
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            disabled={!token.canSubmit}
                            onClick={() => void token.submit()}
                        >
                            {token.checking ? (
                                <>
                                    <Spinner className="size-3" />
                                    Checking…
                                </>
                            ) : (
                                "Connect"
                            )}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            // A check in flight cannot be stopped, so the steps stay until it answers.
                            disabled={token.checking}
                            onClick={() => {
                                token.reset()
                                setOpen(false)
                            }}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}
        </section>
    )
}

export default SubscriptionTokenCard
