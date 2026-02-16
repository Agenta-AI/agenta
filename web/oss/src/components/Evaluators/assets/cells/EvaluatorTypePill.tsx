import {memo, useMemo, type CSSProperties} from "react"

import {Tag} from "antd"

import {EvaluatorTypeBadge} from "../types"

const hexToRgb = (hex?: string) => {
    if (!hex) return null
    let sanitized = hex.replace("#", "")
    if (sanitized.length === 3) {
        sanitized = sanitized
            .split("")
            .map((char) => char + char)
            .join("")
    }
    if (sanitized.length !== 6) return null

    const intVal = Number.parseInt(sanitized, 16)
    if (Number.isNaN(intVal)) return null

    return {
        r: (intVal >> 16) & 255,
        g: (intVal >> 8) & 255,
        b: intVal & 255,
    }
}

const EvaluatorTypePill = memo(({badge}: {badge: EvaluatorTypeBadge}) => {
    const baseHex = badge.colorHex
    const computedStyle = useMemo(() => {
        const rgb = hexToRgb(baseHex)
        if (!rgb) return undefined

        return {
            backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`,
            borderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.32)`,
            color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.88)`,
        } satisfies CSSProperties
    }, [baseHex])

    return (
        <Tag
            bordered
            style={computedStyle}
            color={computedStyle ? undefined : baseHex}
            className="!m-0 capitalize"
        >
            {badge.label}
        </Tag>
    )
})

export default EvaluatorTypePill
