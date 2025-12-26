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
    isEdited?: boolean
    originalData?: KeyValuePair | null
}
export interface TestsetDrawerProps {
    showSelectedSpanText?: boolean
}
