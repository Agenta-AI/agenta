import {createContext, useContext} from "react"

import type {ViewForm, ViewStack} from "./types"

/** Internal: what a mounted view reports to its host. */
export interface ViewEntryApi {
    setForm: (form: ViewForm | null) => void
    setTitle: (title: string) => void
}

export const ViewStackContext = createContext<ViewStack | null>(null)
export const ViewEntryContext = createContext<ViewEntryApi | null>(null)

/** The stack of the nearest `ViewStackHost`. For roots and containers. */
export const useViewStack = (): ViewStack => {
    const stack = useContext(ViewStackContext)
    if (!stack) throw new Error("useViewStack must be used inside a ViewStackHost")
    return stack
}

export const useViewEntry = (hook: string): ViewEntryApi => {
    const entry = useContext(ViewEntryContext)
    if (!entry) throw new Error(`${hook} must be used inside a view of a ViewStackHost`)
    return entry
}
