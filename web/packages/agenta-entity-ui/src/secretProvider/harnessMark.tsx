/**
 * The mark shown beside a harness in the connection card.
 *
 * A harness is a product, and a checkbox row that names three of them reads as a list of words
 * until each carries its own mark. Claude Code and Codex borrow the Anthropic and OpenAI marks
 * from the shared icon set; Pi has no asset yet, so it gets an interim monogram — swap
 * `PiMark` for the real pi.dev mark when it lands.
 */
import type {ComponentType} from "react"

import {getProviderIcon} from "@agenta/ui/select-llm-provider"

/**
 * Interim pi.dev mark: an ink rounded square with a white italic π.
 *
 * Drawn from `colorText` on `colorBgContainer` rather than a fixed ink pair, so the square
 * inverts in dark the way a monochrome wordmark does instead of going olive with `colorPrimary`.
 */
const PiMark = ({className}: {className?: string}) => (
    <span
        aria-hidden
        className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-colorText font-serif text-[10px] italic leading-none text-colorBgContainer ${className ?? ""}`}
    >
        π
    </span>
)

/** Provider whose mark stands in for a harness, for the harnesses that are somebody's product. */
const PROVIDER_MARK_BY_HARNESS: Record<string, string> = {
    claude: "anthropic",
    codex: "openai",
}

/** The mark for a harness id, or `null` for one with no mark to draw. */
export const harnessMarkFor = (harness: string): ComponentType<{className?: string}> | null => {
    if (harness === "pi_core") return PiMark
    const provider = PROVIDER_MARK_BY_HARNESS[harness]
    return provider ? getProviderIcon(provider) : null
}

/** The mark as a node, for call sites that render one inline (the set is a lookup, not a prop). */
export const harnessMarkNode = (harness: string, className = "size-3 shrink-0") => {
    const Mark = harnessMarkFor(harness)
    return Mark ? <Mark className={className} /> : null
}
