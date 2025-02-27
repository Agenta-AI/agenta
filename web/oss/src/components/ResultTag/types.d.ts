import {Tag} from "antd"

export interface ResultTagProps extends React.ComponentProps<typeof Tag> {
    popoverContent?: React.ReactNode
    value1: string | React.ReactNode
    value2?: React.ReactNode
}
