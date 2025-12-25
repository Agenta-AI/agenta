import {ButtonProps} from "antd"
import {KeyValuePair} from "tailwindcss/types/config"

export interface AddToTestsetButtonProps extends ButtonProps {
    label?: string
    icon?: boolean
    children?: React.ReactNode
    testsetData: {
        data: KeyValuePair
        key: string
        id: number
    }[]
}
