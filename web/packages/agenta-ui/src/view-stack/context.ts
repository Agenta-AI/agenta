import {createContext, useContext} from "react"

import type {ViewForm, ViewStack} from "./types"

/** Internal: what a mounted view reports to its host. */
export interface ViewEntryApi {
    setForm: (form: ViewForm | null) => void
    setTitle: (title: string) => void
}

export const ViewStackContext = createContext<ViewStack | null>(null)
export const ViewEntryContext = createContext<ViewEntryApi | null>(null)
/** Internal: where `ViewFooterStart` renders. The chrome's slot for the top view, else null. */
export const ViewFooterStartContext = createContext<HTMLElement | null>(null)

/** The stack of the nearest `ViewStackHost`. For roots and containers. */
export const useViewStack = (): ViewStack => {
    const stack = useContext(ViewStackContext)
    if (!stack) throw new Error("useViewStack must be used inside a ViewStackHost")
    return stack
}

/**
 * The stack of the nearest `ViewStackHost`, or null outside one. For code that renders both in a
 * container with a stack and in hosts without one; with null it opens the view in its own shell.
 */
export const useOptionalViewStack = (): ViewStack | null => useContext(ViewStackContext)

export const useViewEntry = (hook: string): ViewEntryApi => {
    const entry = useContext(ViewEntryContext)
    if (!entry) throw new Error(`${hook} must be used inside a view of a ViewStackHost`)
    return entry
}
