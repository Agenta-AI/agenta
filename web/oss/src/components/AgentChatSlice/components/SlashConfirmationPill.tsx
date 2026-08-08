import {useEffect} from "react"

import type {SlashPill} from "../hooks/useChatSlashCommands"

import RevealCollapse from "./RevealCollapse"

/**
 * Confirmation for a `/model` or `/harness` change, centred above the composer. Contained here
 * rather than a floating toast, matching how the config pane's own change notices behave, and
 * auto-dismissed so it never becomes chrome.
 *
 * It names the draft as the scope on purpose: the write lands on the agent's draft config, shared
 * with the config drawer and every later run — not on this thread alone.
 */
const SlashConfirmationPill = ({
    pill,
    onDismiss,
}: {
    pill: SlashPill | null
    onDismiss: () => void
}) => {
    useEffect(() => {
        if (!pill) return
        const timer = window.setTimeout(onDismiss, 5000)
        return () => window.clearTimeout(timer)
    }, [pill, onDismiss])

    return (
        <RevealCollapse open={!!pill}>
            <div className="mb-2 flex justify-center">
                <div className="flex items-center gap-2 rounded-full border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)] px-[11px] py-[5px] text-[11.5px] text-[var(--ag-colorTextSecondary)]">
                    <span
                        className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] font-mono text-[8px] font-semibold leading-none text-white"
                        style={{background: pill?.color ?? "#586673"}}
                    >
                        {pill?.glyph}
                    </span>
                    <span className="truncate">{pill?.text}</span>
                    <span className="text-[var(--ag-colorTextQuaternary)]">·</span>
                    <span className="shrink-0 text-[var(--ag-colorTextTertiary)]">
                        draft config
                    </span>
                </div>
            </div>
        </RevealCollapse>
    )
}

export default SlashConfirmationPill
