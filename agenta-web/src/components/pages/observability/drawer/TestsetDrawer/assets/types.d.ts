import {Drawer} from "antd"

export type Mapping = {data: string; column: string; newColumn?: string}
export type Preview = {key: string; data: KeyValuePair[]}
export type TestsetTraceData = {key: string; data: KeyValuePair; id: number}
export type TestsetDrawerProps = {
    onClose: () => void
    data: TestsetTraceData[]
} & React.ComponentProps<typeof Drawer>
