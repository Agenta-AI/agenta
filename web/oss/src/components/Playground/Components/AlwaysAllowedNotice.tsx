import {useEffect, useRef} from "react"

import {draftConfigChangeSignalAtom} from "@agenta/shared/state"
import {HeightCollapse} from "@agenta/ui"
import {ArrowCounterClockwise, ShieldCheck, X} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtom} from "jotai"

import {useAlwaysAllowTool} from "@/oss/components/AgentChatSlice/hooks/useAlwaysAllowTool"

/**
 * "Always allowed" notice — the draft-blue counterpart of {@link AgentCommitNotice}, pinned to the
 * bottom of the config pane. Surfaces a per-tool permission the user just granted from the approval
 * dock, with Undo, CONTAINED to the config panel (where the write lands) rather than a floating
 * toast that pulls focus away. Reads the same draft-change signal that pulses the affected section.
 * Undo reverts the write and clears; Dismiss just clears. Collapses in/out via the shared
 * {@link HeightCollapse} (fade + a small Y slide) — the same CSS-native, reduced-motion-proof
 * primitive the composer dock, queued messages, and accordion sections use.
 */
const AlwaysAllowedNotice = ({revisionId}: {revisionId: string}) => {
    const [signal, setSignal] = useAtom(draftConfigChangeSignalAtom)
    const active = Boolean(
        signal &&
        revisionId &&
        signal.revisionId === revisionId &&
        signal.origin === "approval-dock",
    )
    const {revoke} = useAlwaysAllowTool(revisionId)

    // Latch the last matching signal so content stays rendered through the collapse-out.
    const lastRef = useRef(signal)
    if (signal && active) lastRef.current = signal
    const shown = lastRef.current

    // Auto-dismiss 5s after the change (keyed on `at`, so a fresh grant restarts the clock). The
    // persistent section draft dot is independent of this signal, so it stays after the banner goes.
    useEffect(() => {
        if (!active) return
        const t = window.setTimeout(() => setSignal(null), 5000)
        return () => window.clearTimeout(t)
    }, [active, signal?.at, setSignal])

    const label = shown?.label ?? "this tool"

    return (
        <HeightCollapse open={active} durationMs={260} fade slideY={16} inert className="shrink-0">
            <div className="border-0 border-t border-solid border-[color-mix(in_srgb,var(--ag-colorPrimary)_35%,var(--ag-colorBorderSecondary))] bg-[color-mix(in_srgb,var(--ag-colorPrimary)_9%,var(--ag-colorBgElevated))] px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--ag-colorPrimary)_14%,transparent)] text-colorPrimary">
                            <ShieldCheck size={15} weight="fill" />
                        </span>
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-xs font-medium leading-5 text-colorText">
                                Always allowing <span className="font-semibold">{label}</span>
                            </span>
                            <span className="text-[11px] leading-4 text-colorTextSecondary">
                                Saved to this draft — this tool won&apos;t ask again.
                            </span>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <Button
                            type="text"
                            className="!h-6 !gap-1 !rounded-md !px-2 !text-xs !font-medium !text-colorPrimary !bg-[color-mix(in_srgb,var(--ag-colorPrimary)_12%,transparent)] hover:!bg-[color-mix(in_srgb,var(--ag-colorPrimary)_22%,transparent)]"
                            icon={<ArrowCounterClockwise size={12} weight="bold" />}
                            onClick={() => {
                                if (shown?.toolName) revoke(shown.toolName)
                                setSignal(null)
                            }}
                        >
                            Undo
                        </Button>
                        <Button
                            type="text"
                            aria-label="Dismiss"
                            className="!h-6 !w-6 !px-0 !text-colorTextTertiary hover:!bg-colorFillTertiary hover:!text-colorText"
                            icon={<X size={13} />}
                            onClick={() => setSignal(null)}
                        />
                    </div>
                </div>
            </div>
        </HeightCollapse>
    )
}

export default AlwaysAllowedNotice
