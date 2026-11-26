import {createContext, useContext} from "react"

/** Where the right pane's back link leads while a view inside a tab is open. */
export interface PaneBack {
    title: string
    onBack: () => void
    /** The open view's name, after the back link. */
    current?: string
}

/** Lets a tab's inner view replace the pane's tab row with a back link (as Configuration views do). */
export const PaneBackContext = createContext<((back: PaneBack | null) => void) | null>(null)

export const useSetPaneBack = () => useContext(PaneBackContext)
