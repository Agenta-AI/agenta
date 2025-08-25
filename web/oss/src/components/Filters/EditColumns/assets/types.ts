import {ButtonProps, PopoverProps} from "antd"
import {ColumnsType} from "antd/es/table"

export interface EditColumnsProps<RecordType> {
    columns: ColumnsType<RecordType>
    uniqueKey: string
    onChange?: (hidden: string[]) => void
    excludes?: string[]
    buttonText?: string
    popoverProps?: PopoverProps
    buttonProps?: ButtonProps
}
