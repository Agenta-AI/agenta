import {useEffect} from "react"

import {useViewStack} from "@agenta/ui/view-stack"

/** Tells the page whether a view of the stack around it is open. */
export const ReportViewsOpen = ({onChange}: {onChange: (open: boolean) => void}) => {
    const open = useViewStack().depth > 0
    useEffect(() => onChange(open), [onChange, open])
    return null
}
