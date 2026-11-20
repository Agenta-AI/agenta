/**
 * The layout of the builder page's pane, kept in this browser for every chat (design D16): the pane width,
 * whether the pane is hidden and whether it fills the page. A browser that refuses storage
 * keeps the layout for this visit only.
 */
export const BUILDER_LAYOUT_KEY = "agenta:builder:layout"

export interface BuilderPaneLayout {
    /** The pane width in px. */
    width: number
    hidden: boolean
    fullScreen: boolean
}

/** At 1440 px with the 236 px sidebar, the chat is 400 px wide beside the pane (B03). */
export const DEFAULT_BUILDER_PANE_LAYOUT: BuilderPaneLayout = {
    width: 804,
    hidden: false,
    fullScreen: false,
}
export const PANE_MIN_WIDTH = 360
export const PANE_MAX_WIDTH = 1100

export const readBuilderPaneLayout = (): BuilderPaneLayout => {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(BUILDER_LAYOUT_KEY) ?? "{}")
        if (!parsed || typeof parsed !== "object") return DEFAULT_BUILDER_PANE_LAYOUT
        const value = parsed as Partial<Record<keyof BuilderPaneLayout, unknown>>
        return {
            width:
                typeof value.width === "number" && Number.isFinite(value.width)
                    ? Math.min(PANE_MAX_WIDTH, Math.max(PANE_MIN_WIDTH, value.width))
                    : DEFAULT_BUILDER_PANE_LAYOUT.width,
            hidden: value.hidden === true,
            fullScreen: value.fullScreen === true,
        }
    } catch {
        return DEFAULT_BUILDER_PANE_LAYOUT
    }
}

export const writeBuilderPaneLayout = (layout: BuilderPaneLayout) => {
    try {
        window.localStorage.setItem(BUILDER_LAYOUT_KEY, JSON.stringify(layout))
    } catch {
        // Storage refused: the layout lasts for this visit.
    }
}
