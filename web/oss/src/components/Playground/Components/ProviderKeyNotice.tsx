import {useEffect, useRef} from "react"

import {providerKeyAddedSignalAtom} from "@agenta/shared/state"
import {HeightCollapse} from "@agenta/ui"
import {CheckCircle, X} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtom} from "jotai"

/**
 * "API key added" notice — the success-green sibling of {@link AgentCommitNotice} /
 * {@link AlwaysAllowedNotice}, pinned to the bottom of the config pane. Confirms that a provider key
 * the user just connected from the "Connect key" flow has landed and the agent can now run, CONTAINED
 * to the config panel (where the change happened) instead of a floating toast that pulls focus away.
 * Collapses in/out via the shared {@link HeightCollapse} (fade + a small Y slide) — the same
 * CSS-native, reduced-motion-proof primitive the other notices use. Auto-dismisses after a few
 * seconds; Dismiss clears it early.
 */
const ProviderKeyNotice = ({revisionId}: {revisionId: string}) => {
    const [signal, setSignal] = useAtom(providerKeyAddedSignalAtom)
    const active = Boolean(signal && revisionId && signal.revisionId === revisionId)

    // Latch the last matching signal so content stays rendered through the collapse-out.
    const lastRef = useRef(signal)
    if (signal && active) lastRef.current = signal
    const shown = lastRef.current

    // Auto-dismiss 6s after the key lands (keyed on `at`, so a fresh save restarts the clock).
    useEffect(() => {
        if (!active) return
        const t = window.setTimeout(() => setSignal(null), 6000)
        return () => window.clearTimeout(t)
    }, [active, signal?.at, setSignal])

    const provider = shown?.provider

    return (
        <HeightCollapse open={active} durationMs={260} fade slideY={16} inert className="shrink-0">
            <div className="border-0 border-t border-solid border-[color-mix(in_srgb,var(--ag-colorSuccess)_35%,var(--ag-colorBorderSecondary))] bg-[color-mix(in_srgb,var(--ag-colorSuccess)_9%,var(--ag-colorBgElevated))] px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--ag-colorSuccess)_14%,transparent)] text-colorSuccess">
                            <CheckCircle size={15} weight="fill" />
                        </span>
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-xs font-medium leading-5 text-colorText">
                                {provider ? (
                                    <>
                                        <span className="font-semibold">{provider}</span> API key
                                        added
                                    </>
                                ) : (
                                    "API key added"
                                )}
                            </span>
                            <span className="text-[11px] leading-4 text-colorTextSecondary">
                                The agent is ready to run.
                            </span>
                        </div>
                    </div>
                    <Button
                        type="text"
                        aria-label="Dismiss"
                        className="!h-6 !w-6 shrink-0 !px-0 !text-colorTextTertiary hover:!bg-colorFillTertiary hover:!text-colorText"
                        icon={<X size={13} />}
                        onClick={() => setSignal(null)}
                    />
                </div>
            </div>
        </HeightCollapse>
    )
}

export default ProviderKeyNotice
