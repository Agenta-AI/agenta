import {useEffect, useRef} from "react"

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
    const {dirty, valid, leaveDescription, saveLabel} = form
    useEffect(() => {
        setForm({dirty, valid, leaveDescription, saveLabel, save: () => saveRef.current()})
    }, [setForm, dirty, valid, leaveDescription, saveLabel])
    useEffect(() => () => setForm(null), [setForm])
}

/** The view reports its breadcrumb title. A renamed item updates the crumb at once. */
export const useViewTitle = (title: string): void => {
    const {setTitle} = useViewEntry("useViewTitle")
    useEffect(() => {
        setTitle(title)
    }, [setTitle, title])
}
