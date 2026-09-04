/**
 * One account the agent will use, in the pre-create setup step (#6043).
 *
 * Extracted from the template setup drawer's `IntegrationRow` so the drawer and the new card
 * render the same row. What it adds over that original: the `skipped` state (a suggested account
 * the user dismissed, with Undo) and a `DetectedAccount` input, so a template-declared account and
 * a text-detected one differ only by their `required` flag.
 *
 * Connection state is read live from the workspace connections — connecting here is a real,
 * durable act, so a row can already be `Connected` on first render.
 */
import {useEffect, useState} from "react"

import {
    isConnectionActive,
    useToolIntegrationConnections,
    useToolIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import type {DetectedAccount} from "@agenta/entities/workflow"
import {Button} from "@agenta/ui/ui"
import {ArrowCounterClockwise, CheckCircle, Plugs} from "@phosphor-icons/react"
import clsx from "clsx"
import Image from "next/image"

import ConnectDrawer from "../gatewayTool/drawers/ConnectDrawer"

export interface AccountRowProps {
    account: DetectedAccount
    /** Report the live connection state up so the card can compute what is left. */
    onConnectedChange: (slug: string, connected: boolean) => void
    /**
     * A provider that already satisfies this need — the row's own, or one of its alternatives.
     * Resolved by the card from the project's connections so a need the workspace already meets
     * is settled on sight instead of asked for again.
     */
    satisfiedVia?: string
    /** Dismissed by the user. Only ever true for a suggested (non-required) account. */
    skipped?: boolean
    /** Omitted for a required account — there is nothing to skip. */
    onSkip?: (slug: string) => void
    onUndoSkip?: (slug: string) => void
}

const AccountRow = ({
    account,
    onConnectedChange,
    satisfiedVia,
    skipped = false,
    onSkip,
    onUndoSkip,
}: AccountRowProps) => {
    const {integration: detail} = useToolIntegrationDetail(account.slug)
    const {connections} = useToolIntegrationConnections(account.slug)
    // An alternative already connected settles this need as surely as its own provider does.
    const connected = connections.some(isConnectionActive) || !!satisfiedVia
    const [connectOpen, setConnectOpen] = useState(false)

    useEffect(() => {
        // Report the slug that actually satisfies it, so gating counts the alternative.
        onConnectedChange(satisfiedVia ?? account.slug, connected)
    }, [connected, satisfiedVia, account.slug, onConnectedChange])

    const name = detail?.name ?? account.label
    const logo = detail?.logo ?? account.logo
    // Only an unconnected REQUIRED account is highlighted: it is the one thing standing between
    // the user and their agent. A suggested account is an offer, so it stays quiet.
    const blocking = account.required && !connected

    return (
        <div
            className={clsx(
                "rounded-lg border border-solid p-3 transition-colors",
                skipped && "opacity-60",
                connected
                    ? "border-[var(--ag-colorSuccessBorder)] bg-[var(--ag-colorSuccessBg)]"
                    : blocking
                      ? "border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)]"
                      : "border-[var(--ag-colorBorderSecondary)]",
            )}
        >
            <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)]">
                    {logo ? (
                        <Image
                            src={logo}
                            alt={name}
                            width={20}
                            height={20}
                            unoptimized
                            className="object-contain"
                        />
                    ) : (
                        <Plugs size={18} className="text-[var(--ag-colorTextSecondary)]" />
                    )}
                </span>

                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-medium text-[var(--ag-colorText)]">
                            {name}
                        </span>
                        {account.required ? (
                            <span className="shrink-0 rounded-full border border-solid border-[var(--ag-colorWarningBorder)] px-1.5 text-[10px] font-medium text-[var(--ag-colorWarning)]">
                                Required
                            </span>
                        ) : null}
                    </div>
                    {/* Only a template row carries a scope line; a detected one has nothing
                        per-account to say, so it gets no second line at all. */}
                    {skipped || account.why ? (
                        <div className="truncate text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                            {skipped ? "Skipped — the agent can ask later" : account.why}
                        </div>
                    ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    {connected ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-[var(--ag-colorSuccess)]">
                            <CheckCircle size={13} weight="fill" />
                            Connected
                        </span>
                    ) : skipped ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onUndoSkip?.(account.slug)}
                        >
                            <ArrowCounterClockwise size={13} />
                            Undo
                        </Button>
                    ) : (
                        <>
                            {onSkip && !account.required ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onSkip(account.slug)}
                                >
                                    Skip
                                </Button>
                            ) : null}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setConnectOpen(true)}
                            >
                                Connect
                            </Button>
                        </>
                    )}
                </div>
            </div>

            <ConnectDrawer
                open={connectOpen}
                integrationKey={account.slug}
                integrationName={name}
                integrationLogo={logo ?? undefined}
                integrationDescription={account.why}
                authSchemes={detail?.auth_schemes ?? ["oauth"]}
                onClose={() => setConnectOpen(false)}
                onSuccess={() => setConnectOpen(false)}
            />
        </div>
    )
}

export default AccountRow
