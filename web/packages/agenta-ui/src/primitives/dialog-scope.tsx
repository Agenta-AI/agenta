import * as React from "react"

/** The positioned element that dialogs and alerts opened inside a region (a side pane) cover. */
const DialogScopeContext = React.createContext<HTMLElement | null>(null)

function DialogScope({
    container,
    children,
}: {
    container: HTMLElement | null
    children: React.ReactNode
}) {
    return <DialogScopeContext.Provider value={container}>{children}</DialogScopeContext.Provider>
}

function useDialogScope() {
    return React.useContext(DialogScopeContext)
}

export {DialogScope, useDialogScope}
