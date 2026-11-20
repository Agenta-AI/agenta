import {useEffect, useRef, type ReactNode} from "react"

import {createPortal} from "react-dom"

import {useViewEntry} from "./context"
import type {ViewDef, ViewForm} from "./types"

/** Identity helper that types a view definition. */
export const defineView = <P>(def: ViewDef<P>): ViewDef<P> => def

/**
 * Called once in the body of an "on_save" view. The stack reads `dirty` to guard leaving, and
 * calls the latest `save` for Save and for "Save changes".
 */
export const useViewForm = (form: ViewForm): void => {
    const {setForm} = useViewEntry("useViewForm")
    const saveRef = useRef(form.save)
    saveRef.current = form.save
    const {dirty, valid, leaveDescription, saveLabel, savingLabel} = form
    useEffect(() => {
        setForm({
            dirty,
            valid,
            leaveDescription,
            saveLabel,
            savingLabel,
            save: () => saveRef.current(),
        })
    }, [setForm, dirty, valid, leaveDescription, saveLabel, savingLabel])
    useEffect(() => () => setForm(null), [setForm])
}

/**
 * Renders its children at the left of the chrome's action row, on the row of Cancel and Save or
 * Done (canvas F02: "Remove from agent"). Nothing shows while the view is not on top or the chrome
 * draws no action row; it leaves with the view.
 */
export const ViewFooterStart = ({children}: {children: ReactNode}) => {
    const {footerStart} = useViewEntry("ViewFooterStart")
    return footerStart ? createPortal(children, footerStart) : null
}

/** The view reports its breadcrumb title. A renamed item updates the crumb at once. */
export const useViewTitle = (title: string): void => {
    const {setTitle} = useViewEntry("useViewTitle")
    useEffect(() => {
        setTitle(title)
    }, [setTitle, title])
}
