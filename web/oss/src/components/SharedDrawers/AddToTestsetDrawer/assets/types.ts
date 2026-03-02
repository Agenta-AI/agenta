import {KeyValuePair} from "tailwindcss/types/config"

export interface Mapping {
    /** Stable unique ID for React key - prevents cursor loss during typing */
    id: string
    data: string
    column: string
    newColumn?: string
}

/** Generate a unique ID for a new mapping */
export function createMappingId(): string {
    return `mapping-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
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
