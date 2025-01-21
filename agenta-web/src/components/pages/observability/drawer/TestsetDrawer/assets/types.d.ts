import {Drawer} from "antd"
import {KeyValuePair} from "tailwindcss/types/config"

export type Mapping = {data: string; column: string; newColumn?: string}
export type Preview = {key: string; data: KeyValuePair[]}
export type TestsetColumn = {column: string; isNew: boolean}
export type TestsetTraceData = {
    key: string
    data: KeyValuePair
    id: number
    isEdited?: false
    originalData?: KeyValuePair | null
}
export type TestsetDrawerProps = {
    onClose: () => void
    data: TestsetTraceData[]
    showSelectedSpanText?: boolean
} & React.ComponentProps<typeof Drawer>
