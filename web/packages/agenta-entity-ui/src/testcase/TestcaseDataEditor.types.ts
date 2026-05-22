import type {ReactNode} from "react"

import type {PropertyType} from "@agenta/ui/drill-in"

import type {RootDrawerViewMode} from "./codeFormat"

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
    /**
     * Controlled root view mode. When provided, the in-body root toolbar is
     * suppressed and the parent (e.g. TestcaseDrawer) is responsible for
     * rendering the Form/JSON/YAML switcher.
     */
    rootViewMode?: RootDrawerViewMode
    /**
     * Controlled collapse-all signal. Increment to trigger collapse-all in the
     * Form rendering. Only meaningful when `rootViewMode === "form"`.
     */
    collapseSignal?: number
}

export interface TestcaseDataEditorRootItem {
    key: string
    name: string
    value: unknown
    isColumn: boolean
}
