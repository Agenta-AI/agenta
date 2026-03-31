import type {FormInstance} from "antd"

export interface CustomRenderHelpers {
    setValue: (newValue: unknown) => void
    renameKey: (newKey: string) => void
    renderDefault: () => React.ReactNode
}

export type CustomRenderFn = (
    path: (string | number)[],
    key: string | number,
    value: unknown,
    helpers: CustomRenderHelpers,
) => React.ReactNode | null | undefined

export interface BaseNodeProps {
    form: FormInstance
    path: (string | number)[]
    /** key being rendered (string for object, number for array index) */
    k: string | number
    value: unknown
    depth: number
    collapsed: Set<string>
    toggleFold: (key: string) => void
    /** Update the value at the provided path */
    onChange: (path: (string | number)[], newValue: unknown) => void
    /** Rename key at provided path */
    handleRename: (path: (string | number)[], newKey: string) => void
    customRender?: CustomRenderFn
    className?: string
}
