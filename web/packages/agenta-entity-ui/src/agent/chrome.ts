/**
 * Chrome shared by the agent identity's two halves — the icon chip and the name — so a host that
 * assembles them (or the composed [[AgentIdentity]]) never restates a literal.
 */

/** The bar's 20px chip: geometry only, so a host's colours (or the agent's) are the only ones set. */
export const AGENT_CHIP_BOX = "flex h-5 w-5 shrink-0 items-center justify-center rounded"

/** What the chip wears when nobody picked an icon. */
export const AGENT_CHIP_FALLBACK = "bg-secondary text-muted-foreground"

/** One keyboard-focus ring for both controls: the shared `focus-ring` (FORM-02). */
export const AGENT_FOCUS_RING = "focus-ring"
