import type {ReactNode} from "react"

import type {PropertyType} from "@agenta/ui/drill-in"

export type TestcaseDataEditorMode = "view" | "edit"
export type TestcaseDataEditorSurface = "drawer" | "playground" | "inline"
export type TestcaseDataEditorPathMode = "direct" | "nested" | "auto"

export interface TestcaseDataEditorColumn {
    key: string
    name?: string
    label?: string
    type?: string
    schema?: unknown
    pathMode?: TestcaseDataEditorPathMode
}

export interface TestcaseDataEditorFeatures {
    typeChips?: boolean
    rootViewMode?: boolean
    columnMapping?: boolean
    showProperties?: boolean
}

export interface TestcaseDataEditorResolvedFeatures {
    typeChips: boolean
    rootViewMode: boolean
    columnMapping: boolean
    showProperties: boolean
}

export interface TestcaseDataEditorProps {
    value: Record<string, unknown> | null | undefined
    columns?: TestcaseDataEditorColumn[]
    onChange?: (nextValue: Record<string, unknown>) => void
    mode?: TestcaseDataEditorMode
    surface?: TestcaseDataEditorSurface
    features?: TestcaseDataEditorFeatures
    initialPath?: string[]
    onPathChange?: (path: string[]) => void
    className?: string
    label?: string
    headerSlot?: ReactNode
    columnOptions?: {value: string; label: string}[]
    mappedPaths?: Map<string, string>
    onMapToColumn?: (dataPath: string, column: string) => void
    onUnmap?: (dataPath: string) => void
    getDefaultValueForType?: (type: PropertyType) => unknown
}

export interface TestcaseDataEditorRootItem {
    key: string
    name: string
    value: unknown
    isColumn: boolean
}
