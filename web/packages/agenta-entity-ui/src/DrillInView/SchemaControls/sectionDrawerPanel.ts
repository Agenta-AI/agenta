/** The open SectionDrawer's panel, so dialogs raised inside it can mask and centre within it. */
import {createContext, useContext} from "react"

export const SectionDrawerPanelContext = createContext<HTMLElement | null>(null)

export const useSectionDrawerPanel = () => useContext(SectionDrawerPanelContext)
