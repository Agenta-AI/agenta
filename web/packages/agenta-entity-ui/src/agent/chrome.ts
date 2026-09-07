/**
 * Chrome shared by the agent identity's two halves — the icon chip and the name — so a host that
 * assembles them (or the composed [[AgentIdentity]]) never restates a literal.
 */

/** The bar's 24px chip: geometry only, so a host's colours (or the agent's) are the only ones set. */
export const AGENT_CHIP_BOX = "flex h-6 w-6 shrink-0 items-center justify-center rounded-md"

/** What the chip wears when nobody picked an icon. */
export const AGENT_CHIP_FALLBACK = "bg-colorFillSecondary text-[var(--ag-preset-cyan-text)]"

/** One keyboard-focus ring for both controls; `--color-focus-ring` resolves on desktop and on /m. */
export const AGENT_FOCUS_RING =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
