/**
 * The builder page layout, kept in this browser for every chat (design D16): the pane width,
 * whether the pane is hidden and whether it fills the page. A browser that refuses storage
 * keeps the layout for this visit only.
 */
export const BUILDER_LAYOUT_KEY = "agenta:builder:layout"

export interface BuilderLayout {
    /** The pane width in px. */
    width: number
    hidden: boolean
    fullScreen: boolean
}

export const DEFAULT_BUILDER_LAYOUT: BuilderLayout = {width: 560, hidden: false, fullScreen: false}
export const PANE_MIN_WIDTH = 360
export const PANE_MAX_WIDTH = 1100

export const readBuilderLayout = (): BuilderLayout => {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(BUILDER_LAYOUT_KEY) ?? "{}")
        if (!parsed || typeof parsed !== "object") return DEFAULT_BUILDER_LAYOUT
        const value = parsed as Partial<Record<keyof BuilderLayout, unknown>>
        return {
            width:
                typeof value.width === "number" && Number.isFinite(value.width)
                    ? Math.min(PANE_MAX_WIDTH, Math.max(PANE_MIN_WIDTH, value.width))
                    : DEFAULT_BUILDER_LAYOUT.width,
            hidden: value.hidden === true,
            fullScreen: value.fullScreen === true,
        }
    } catch {
        return DEFAULT_BUILDER_LAYOUT
    }
}

export const writeBuilderLayout = (layout: BuilderLayout) => {
    try {
        window.localStorage.setItem(BUILDER_LAYOUT_KEY, JSON.stringify(layout))
    } catch {
        // Storage refused: the layout lasts for this visit.
    }
}
