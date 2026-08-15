import {useMemo, type ReactNode} from "react"

import {agentIconAtomFamily, type AgentIconRecord} from "@agenta/entities/workflow"
import {
    agentIconChrome,
    type AgentIconChrome,
    type AgentIconChromeOptions,
} from "@agenta/ui/agent-icon"
import {useAtomValue} from "jotai"

export type {AgentIconChrome} from "@agenta/ui/agent-icon"

/**
 * Bind an agent's persisted icon to the presentation layer. Lives here rather than in the app so
 * package-level surfaces (AgentCard, and whatever comes next) can reach it — `@agenta/entity-ui` is
 * exactly the "entity-specific UI" layer, and a package can never import from `@/oss`.
 *
 * Keep this module free of the picker: the sidebar imports it on every route, and the picker pulls
 * the virtualizer and the popover with it.
 */
export function useAgentIconRecord(workflowId: string | null | undefined): AgentIconRecord | null {
    return useAtomValue(agentIconAtomFamily(workflowId ?? ""))
}

/**
 * The agent's chrome, merged with the call site's own fallback. Always returns something, so call
 * sites read `<span className={cn(box, chrome.className)} style={chrome.style}>{chrome.glyph}</span>`
 * with no branching of their own.
 */
export function useAgentIconChrome(
    workflowId: string | null | undefined,
    options: AgentIconChromeOptions,
): AgentIconChrome {
    const record = useAgentIconRecord(workflowId)
    const {size, fallbackGlyph, fallbackClassName, bare} = options
    return useMemo(
        () => agentIconChrome(record, {size, fallbackGlyph, fallbackClassName, bare}),
        [record, size, fallbackGlyph, fallbackClassName, bare],
    )
}

export interface AgentGlyphProps {
    workflowId: string | null | undefined
    size: number
    fallback: ReactNode
    /** Draw the glyph bare, with no tinted box (sidebar tree rows). */
    bare?: boolean
    /** Menus clone their icon to stamp a class on it (antd hangs the icon→label gap off
     * `.ant-menu-item-icon`), so this has to arrive on the root element. */
    className?: string
}

/**
 * The bare-glyph case as a component, for call sites that render through a non-hook seam (the
 * sidebar registry's `getIcon`).
 *
 * ALWAYS one real element, never a fragment: a fragment silently swallows the className a menu
 * clones onto it, which cost the sidebar rows their icon→label gap.
 */
export const AgentGlyph = ({
    workflowId,
    size,
    fallback,
    bare = true,
    className,
}: AgentGlyphProps) => {
    const chrome = useAgentIconChrome(workflowId, {size, fallbackGlyph: fallback, bare})

    return (
        <span
            className={["flex items-center", chrome.className, className].filter(Boolean).join(" ")}
            style={chrome.style}
        >
            {chrome.glyph}
        </span>
    )
}
