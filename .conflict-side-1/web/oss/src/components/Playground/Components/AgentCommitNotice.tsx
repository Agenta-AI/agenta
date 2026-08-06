import {useLayoutEffect, useRef, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {agentSelfCommitSignalAtom} from "@agenta/shared/state"
import {HeightCollapse} from "@agenta/ui"
import {Robot} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtom, useAtomValue} from "jotai"

/**
 * Agent self-commit notice, rendered by MainLayout as the LAST row of the config pane's flex column
 * — BELOW the scrolling sections, so it is pinned to the pane's bottom edge regardless of content
 * height or scroll position, and can never shift the sections. Shown while the shared signal targets
 * the displayed revision; Dismiss clears it (and the teal section dots with it). Collapses in/out via
 * the shared {@link HeightCollapse} (fade + a small Y slide) — the same CSS-native, reduced-motion-
 * proof primitive the composer dock and the draft-change notice use.
 */
const AgentCommitNotice = ({revisionId}: {revisionId: string}) => {
    const [signal, setSignal] = useAtom(agentSelfCommitSignalAtom)
    const active = Boolean(signal && revisionId && signal.revisionId === revisionId)

    // Latch the last matching signal so the content stays rendered through the collapse-out.
    const lastSignalRef = useRef(signal)
    if (signal && active) lastSignalRef.current = signal
    const shownSignal = lastSignalRef.current

    // Commit message comes from the committed revision entity (the stream part carries only
    // id/version) — also covers the notice surviving a reload while the signal is set.
    const revisionData = useAtomValue(
        workflowMolecule.selectors.data(shownSignal?.revisionId ?? ""),
    ) as {message?: string | null} | null

    // Long commit messages get a collapse/expand toggle instead of a tooltip: collapsed
    // clamps to two lines, expanded caps at a scrollable box so an essay can't grow the pane.
    const messageRef = useRef<HTMLParagraphElement>(null)
    const [expanded, setExpanded] = useState(false)
    const [overflowing, setOverflowing] = useState(false)
    const commitMessage = revisionData?.message?.trim() || null

    useLayoutEffect(() => {
        setExpanded(false)
    }, [shownSignal?.revisionId, commitMessage])

    useLayoutEffect(() => {
        const el = messageRef.current
        if (!el || expanded) return
        setOverflowing(el.scrollHeight - el.clientHeight > 1)
    }, [commitMessage, expanded, active])

    const rawVersion = shownSignal?.version ? String(shownSignal.version) : null
    const version = rawVersion ? (rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`) : null

    return (
        <HeightCollapse open={active} durationMs={240} fade slideY={12} inert className="shrink-0">
            {shownSignal ? (
                <div className="border-0 border-t border-solid border-colorBorderSecondary bg-[var(--ag-colorBgElevated)] px-4 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2.5">
                            <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--ag-c-13C2C2,#13c2c2)_15%,transparent)] text-[var(--ag-c-13C2C2,#13c2c2)]">
                                <Robot size={15} weight="fill" />
                            </span>
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-xs font-medium leading-5 text-colorText">
                                    Agent updated this configuration
                                    {version ? ` in ${version}` : ""} — changed sections are marked
                                </span>
                                {commitMessage ? (
                                    <div className="flex min-w-0 flex-col items-start gap-0.5">
                                        <p
                                            ref={messageRef}
                                            className={`m-0 min-w-0 break-words text-[11px] leading-4 text-colorTextSecondary ${
                                                expanded
                                                    ? "max-h-24 overflow-y-auto pr-1"
                                                    : "line-clamp-2 overflow-hidden"
                                            }`}
                                        >
                                            “{commitMessage}”
                                        </p>
                                        {overflowing || expanded ? (
                                            <button
                                                type="button"
                                                className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-medium leading-4 text-colorPrimary hover:underline"
                                                onClick={() => setExpanded((v) => !v)}
                                            >
                                                {expanded ? "Show less" : "Show more"}
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        <Button
                            type="text"
                            className="!h-6 shrink-0 !px-2 !text-xs"
                            onClick={() => setSignal(null)}
                        >
                            Dismiss
                        </Button>
                    </div>
                </div>
            ) : null}
        </HeightCollapse>
    )
}

export default AgentCommitNotice
