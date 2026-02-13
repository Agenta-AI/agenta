import React, {useCallback, useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {usePlaygroundLayout} from "@/oss/components/Playground/hooks/usePlaygroundLayout"
import {schemaInputKeysAtom} from "@/oss/components/Playground/state/atoms/variants"
import {inputRowsByIdFamilyAtom} from "@/oss/state/generation/entities"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

interface Props {
    variantId: string
    rowId: string
    propertyId: string
    className?: string
    as?: string
    view?: string
    placeholder?: string
    disabled?: boolean
    // forwarded to SimpleInput when `as` includes "SimpleInput"
    editorProps?: Record<string, any>
}

/**
 * VariableControlAdapter
 *
 * Adapter for rendering and editing generation variables using the same
 * control renderers as PlaygroundVariantPropertyControl, without touching
 * prompt configuration state. Reads from normalized generation selectors
 * and writes to normalized input rows.
 */
const VariableControlAdapter: React.FC<Props> = ({
    variantId,
    rowId,
    propertyId,
    className,
    as = "SimpleInput",
    view,
    placeholder,
    disabled,
    editorProps,
}) => {
    const rowState = useAtomValue(useMemo(() => inputRowsByIdFamilyAtom(rowId), [rowId])) as any

    const {value, name} = useMemo(() => {
        const arr = rowState?.variables || []
        const node = (arr as any[]).find((n) => n?.__id === propertyId)

        const v = node ? (node?.content?.value ?? node?.value) : ""
        const val = typeof v === "string" ? v : String(v ?? "")
        return {value: val, name: node?.key}
    }, [rowState, variantId, propertyId])

    // Custom app variable gating: disable controls for names not in schema keys
    const schemaKeys = useAtomValue(schemaInputKeysAtom) as string[]
    const flags = useAtomValue(
        useMemo(() => variantFlagsAtomFamily({revisionId: variantId}), [variantId]),
    ) as any
    const disableForCustom = useMemo(() => {
        const allowedSet = new Set(Array.isArray(schemaKeys) ? schemaKeys : [])
        return Boolean(flags?.isCustom && name && !allowedSet.has(name as string))
    }, [flags, schemaKeys, name])

    const setRow = useSetAtom(useMemo(() => inputRowsByIdFamilyAtom(rowId), [rowId]))

    const handleChange = useCallback(
        (nextText: any) => {
            const nextVal = typeof nextText === "string" ? nextText : String(nextText ?? "")
            setRow((draft: any) => {
                if (!draft) return
                if (!draft.variables) draft.variables = []
                let arr: any[] = Array.isArray(draft.variables) ? draft.variables : []
                const node = arr.find((n: any) => n?.__id === propertyId)

                if (!node) return
                if (node.content && typeof node.content === "object") node.content.value = nextVal
                node.value = nextVal
            })
        },
        [setRow, variantId, propertyId],
    )

    const {isComparisonView} = usePlaygroundLayout()
    const viewType = isComparisonView ? "comparison" : "single"

    const effectivePlaceholder = placeholder || "Enter a value"

    return (
        <SharedEditor
            header={
                <Typography className="playground-property-control-label font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
                    {name}
                </Typography>
            }
            key={propertyId}
            editorType={viewType === "single" && view !== "focus" ? "border" : "borderless"}
            handleChange={handleChange}
            initialValue={value}
            editorClassName={className}
            placeholder={effectivePlaceholder}
            disabled={disabled || disableForCustom}
            className={clsx(
                "relative flex flex-col gap-1 rounded-[theme(spacing.2)]",
                viewType === "single" && view !== "focus" ? "" : "bg-transparent",
                className,
            )}
            editorProps={{enableResize: true, boundWidth: true, ...editorProps}}
        />
    )
}

export default VariableControlAdapter
