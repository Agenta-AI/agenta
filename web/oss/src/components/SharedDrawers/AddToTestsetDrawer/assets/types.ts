import {Drawer} from "antd"
import {KeyValuePair} from "tailwindcss/types/config"

export interface Mapping {
    data: string
    column: string
    newColumn?: string
}
export interface Preview {
    key: string
    data: KeyValuePair[]
}
export interface TestsetColumn {
    column: string
    isNew: boolean
}
export interface TestsetTraceData {
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
