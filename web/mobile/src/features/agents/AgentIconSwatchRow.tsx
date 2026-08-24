import {AGENT_ICON_COLORS, isHexColor, normalizeHex} from "@agenta/ui/agent-icon"

/**
 * The colour row. Nine palette swatches plus the OS colour picker for anything else.
 *
 * A phone gets the native `<input type="color">` rather than the desktop's saturation square and
 * hue strip: two pointer-drag surfaces inside a scrolling sheet fight the scroll, and the OS picker
 * is the control someone already knows.
 *
 * `selected` is null until the agent has a stored choice, so nothing reads as picked before it is.
 */
export const AgentIconSwatchRow = ({
    selected,
    onPick,
}: {
    selected: string | null
    onPick: (hex: string) => void
}) => (
    <div className="flex flex-wrap items-center gap-3">
        {AGENT_ICON_COLORS.map(([solid]) => {
            const isSelected = solid.toLowerCase() === selected?.toLowerCase()
            return (
                <button
                    key={solid}
                    type="button"
                    aria-label={solid}
                    aria-pressed={isSelected}
                    onClick={() => onPick(solid)}
                    // size-8 is a thumb, not the desktop's size-5 cursor target.
                    className="size-8 shrink-0 cursor-pointer rounded-full border border-solid border-black/10 p-0 dark:border-white/20"
                    style={{
                        background: solid,
                        // outline, not ring: it leaves a genuinely transparent gap, so the swatch
                        // reads the same on any sheet background.
                        ...(isSelected ? {outline: `2px solid ${solid}`, outlineOffset: 2} : null),
                    }}
                />
            )
        })}
        <label
            className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-full border border-solid border-black/10 dark:border-white/20"
            style={{
                background:
                    "conic-gradient(#d61010,#faad14,#389e0d,#0e7490,#1668dc,#7c3aed,#d61010)",
            }}
        >
            <span className="sr-only">Custom colour</span>
            <input
                type="color"
                value={selected ?? "#113955"}
                onChange={(event) => {
                    const next = event.target.value
                    if (isHexColor(next)) onPick(normalizeHex(next).toUpperCase())
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
        </label>
    </div>
)
