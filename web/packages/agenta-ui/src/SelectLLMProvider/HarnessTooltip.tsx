/**
 * The harness explainer shown on every harness label in the model picker.
 *
 * A harness is the one concept the picker introduces that has no counterpart in a plain model
 * dropdown, so the same sentence answers it wherever a harness is named — the flyout's group
 * labels and its single-harness `via` header.
 */

/** Where "About harnesses" goes: the concept page that defines the term. */
export const HARNESS_DOCS_URL = "https://docs.agenta.ai/concepts/harnesses-and-models"

export const HARNESS_TOOLTIP_COPY =
    "A harness is the runtime that executes the model — the same model can be available through several harnesses."

const HarnessTooltip = () => (
    <span className="flex flex-col gap-1">
        <span>{HARNESS_TOOLTIP_COPY}</span>
        <a
            href={HARNESS_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            // The tooltip is an ink surface in BOTH themes, so its link takes the mode-independent
            // step rather than `colorLink`, which is olive in light and unreadable here.
            className="text-[var(--ag-colorLinkOnInk)] no-underline hover:underline"
        >
            About harnesses
        </a>
    </span>
)

export default HarnessTooltip
