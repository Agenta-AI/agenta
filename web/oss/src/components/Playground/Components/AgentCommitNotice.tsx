import {useEffect, useLayoutEffect, useRef, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {agentSelfCommitSignalAtom} from "@agenta/shared/state"
import {Robot} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtom, useAtomValue} from "jotai"

/**
 * Agent self-commit notice, rendered by MainLayout as the LAST row of the config pane's
 * flex column — BELOW the scrolling sections, so it is pinned to the pane's bottom edge
 * regardless of content height or scroll position, and can never shift the sections.
 * Shown while the shared signal targets the displayed revision; Dismiss clears it (and
 * the teal section dots with it). Enters/exits with an opacity + rise transition.
 */
const AgentCommitNotice = ({revisionId}: {revisionId: string}) => {
    const [signal, setSignal] = useAtom(agentSelfCommitSignalAtom)
    const active = Boolean(signal && revisionId && signal.revisionId === revisionId)

    // Latch the last matching signal so the content stays rendered through the exit fade.
    const lastSignalRef = useRef(signal)
    if (signal && active) lastSignalRef.current = signal
    const shownSignal = lastSignalRef.current

    // Enter/exit: `render` keeps the node mounted through the exit transition; `shown`
    // drives the opacity/translate classes. Double rAF so the hidden state paints first.
    const [render, setRender] = useState(active)
    const [shown, setShown] = useState(false)
    useEffect(() => {
        if (active) {
            setRender(true)
            // Cancel BOTH frames: killing only the outer id lets an already-scheduled inner
            // rAF flash the notice back in after the hide branch ran.
            let innerRaf = 0
            const raf = requestAnimationFrame(() => {
                innerRaf = requestAnimationFrame(() => setShown(true))
            })
            return () => {
                cancelAnimationFrame(raf)
                cancelAnimationFrame(innerRaf)
            }
        }
        setShown(false)
        const t = window.setTimeout(() => setRender(false), 240)
        return () => window.clearTimeout(t)
    }, [active])

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
    }, [commitMessage, expanded, render])

    if (!render || !shownSignal) return null

    const rawVersion = shownSignal.version ? String(shownSignal.version) : null
    const version = rawVersion ? (rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`) : null

    return (
        <div
            className={`shrink-0 border-0 border-t border-solid border-colorBorderSecondary bg-[var(--ag-colorBgElevated)] px-4 py-2.5 motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out ${
                shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--ag-c-13C2C2,#13c2c2)_15%,transparent)] text-[var(--ag-c-13C2C2,#13c2c2)]">
                        <Robot size={15} weight="fill" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-xs font-medium leading-5 text-colorText">
                            Agent updated this configuration{version ? ` in ${version}` : ""} —
                            changed sections are marked
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
    )
}

export default AgentCommitNotice
