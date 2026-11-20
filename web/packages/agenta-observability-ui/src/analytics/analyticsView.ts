import {createContext, useContext} from "react"

import {sharedAnalyticsViewAtoms, type AnalyticsViewAtoms} from "@agenta/observability/analytics"

/** The view the page below reads: its own when it is locked to one agent, else the shared one. */
export const AnalyticsViewContext = createContext<AnalyticsViewAtoms>(sharedAnalyticsViewAtoms)

export const useAnalyticsView = (): AnalyticsViewAtoms => useContext(AnalyticsViewContext)
