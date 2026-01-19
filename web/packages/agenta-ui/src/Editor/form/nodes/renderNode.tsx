import {type ReactNode} from "react"

import ArrayNode from "./ArrayNode"
import {CustomRenderFn} from "./NodeTypes"
import {BaseNodeProps} from "./NodeTypes"
import ObjectNode from "./ObjectNode"
import PrimitiveNode from "./PrimitiveNode"

const renderNode = (props: BaseNodeProps): ReactNode => {
    const {customRender, path, k, value, onChange, handleRename} = props as any as {
        customRender?: CustomRenderFn
        path: (string | number)[]
        k: string | number
        value: unknown
        onChange: (path: (string | number)[], v: unknown) => void
        handleRename: (p: (string | number)[], nk: string) => void
    }

    const buildDefaultNode = (): ReactNode => {
        if (Array.isArray(value)) {
            return <ArrayNode {...props} value={value} />
        }
        if (typeof value === "object" && value !== null) {
            return <ObjectNode {...props} value={value as Record<string, unknown>} />
        }
        return <PrimitiveNode {...props} value={value} />
    }

    if (customRender) {
        const helpers = {
            setValue: (newValue: unknown) => onChange(path, newValue),
            renameKey: (newKey: string) => handleRename(path, newKey),
            renderDefault: () => buildDefaultNode(),
        }
        const out = customRender(path, k, value, helpers)
        if (out === null) return null
        if (out !== undefined) return out
    }

    if (Array.isArray(value)) {
        return <ArrayNode {...props} value={value} />
    }
    if (typeof value === "object" && value !== null) {
        return <ObjectNode {...props} value={value as Record<string, unknown>} />
    }
    return <PrimitiveNode {...props} value={value} />
}

export default renderNode
