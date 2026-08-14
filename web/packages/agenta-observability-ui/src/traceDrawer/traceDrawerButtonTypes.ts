import type {ReactNode} from "react"

import type {EnhancedButtonProps} from "@agenta/ui/components/presentational"

export interface TraceDrawerButtonProps extends EnhancedButtonProps {
    label?: ReactNode
    icon?: boolean
    children?: ReactNode
    /** A playground test result; typed loosely since playground sits above this package. */
    result: unknown
}
