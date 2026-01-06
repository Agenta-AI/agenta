import {ButtonProps} from "antd"
import {KeyValuePair} from "tailwindcss/types/config"

export interface AddToTestsetButtonProps extends ButtonProps {
    label?: string
    icon?: boolean
    children?: React.ReactNode
    /** Span IDs to open drawer with - preferred approach (fetches from entity cache) */
    spanIds?: string[]
    /** @deprecated Use spanIds instead - legacy prop for backward compatibility */
    testsetData?: {
        data: KeyValuePair
        key: string
        id: number
    }[]
}
