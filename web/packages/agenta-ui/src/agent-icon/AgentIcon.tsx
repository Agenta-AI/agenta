import {memo, type CSSProperties, type ReactNode} from "react"

import {darkColorFor, darkTintFor, tintForColor} from "./colors"

/** What the picker hands back and what we persist. The tint and the SVG are NOT part of it: the
 * tint derives from the colour, and the glyph is looked up by name. */
export interface AgentIconSelection {
    /** Kebab-case Phosphor name. */
    icon: string
    color: string
    /** Cached so a cold render never waits on the ~880 KB catalog chunk. */
    path: string
}

export interface AgentIconProps {
    /** Inner SVG markup from the generated catalog — a 0 0 256 256 viewBox drawn in currentColor. */
    path: string
    /** Glyph size in px, matching the Phosphor `size` the call site used before. */
    size: number
    className?: string
}

/**
 * One agent's chosen glyph. Only the glyph — every call site already owns a chip box with its own
 * size and radius, so this renders inside it and inherits `currentColor`.
 *
 * The markup is generated at build time from @phosphor-icons/core, never user input.
 */
export const AgentIcon = memo(({path, size, className}: AgentIconProps) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 256 256"
        fill="currentColor"
        aria-hidden
        className={className}
        dangerouslySetInnerHTML={{__html: path}}
    />
))

AgentIcon.displayName = "AgentIcon"

/** Tailwind reads these as static strings; the values arrive as custom properties. */
export const AGENT_ICON_TEXT_CLASS =
    "text-[var(--agent-icon-fg)] dark:text-[var(--agent-icon-fg-dark)]"

/** The tinted box. Sites that draw the glyph bare (sidebar rows) use the text class alone. */
export const AGENT_ICON_CHIP_CLASS = `bg-[var(--agent-icon-bg)] dark:bg-[var(--agent-icon-bg-dark)] ${AGENT_ICON_TEXT_CLASS}`

/** Light values come from the palette pair; dark is derived, because a hand-tuned light tint is
 * unreadable on a dark surface and a custom colour has no dark pair to look up. */
export const agentIconChipStyle = (color: string): CSSProperties =>
    ({
        "--agent-icon-fg": color,
        "--agent-icon-bg": tintForColor(color),
        "--agent-icon-fg-dark": darkColorFor(color),
        "--agent-icon-bg-dark": darkTintFor(color),
    }) as CSSProperties

export interface AgentIconChromeOptions {
    size: number
    /** What to draw when the agent has no icon of its own. */
    fallbackGlyph: ReactNode
    /** The colours that go with that fallback — the call site's existing chip classes. */
    fallbackClassName?: string
    /** Draw the glyph bare, with no tinted box (sidebar tree rows). */
    bare?: boolean
}

export interface AgentIconChrome {
    glyph: ReactNode
    className: string
    style?: CSSProperties
}

/**
 * Merge an agent's icon with the call site's own fallback. TOTAL on purpose: every site renders
 * `<span className={cn(box, chrome.className)} style={chrome.style}>{chrome.glyph}</span>`, so the
 * "did they customise?" branch lives here once instead of as a `??` at each of the five sites.
 * Geometry stays with the site; only the colour/glyph merge is shared.
 */
export const agentIconChrome = (
    record: AgentIconSelection | null | undefined,
    {size, fallbackGlyph, fallbackClassName = "", bare}: AgentIconChromeOptions,
): AgentIconChrome =>
    record
        ? {
              glyph: <AgentIcon path={record.path} size={size} />,
              className: bare ? AGENT_ICON_TEXT_CLASS : AGENT_ICON_CHIP_CLASS,
              style: agentIconChipStyle(record.color),
          }
        : {glyph: fallbackGlyph, className: fallbackClassName}
