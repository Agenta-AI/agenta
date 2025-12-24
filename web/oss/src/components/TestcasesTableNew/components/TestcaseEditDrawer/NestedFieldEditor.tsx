import {memo, useCallback, useState} from "react"

import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import clsx from "clsx"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

import {
    MAX_NESTED_DEPTH,
    tryParseAsObject,
    tryParseAsArray,
    getNestedValue,
    getArrayItemValue,
    canExpandValue,
    canExpandAsArray,
} from "./fieldUtils"
import {useTreeStyles} from "./useTreeStyles"

const {Text} = Typography

export interface NestedFieldEditorProps {
    fieldKey: string
    fieldName: string
    value: string
    onChange: (value: string) => void
    depth: number
    isLast?: boolean
}

/**
 * Recursive component for rendering nested fields with expand/collapse capability
 * The expand/collapse button is rendered in the field name row (same line as field label)
 */
const NestedFieldEditor = memo(
    ({fieldKey, fieldName, value, onChange, depth, isLast = false}: NestedFieldEditorProps) => {
        const classes = useTreeStyles()
        const [isExpanded, setIsExpanded] = useState(false)
        const obj = tryParseAsObject(value)
        const arr = tryParseAsArray(value)
        const canExpandObj = obj !== null && Object.keys(obj).length > 0 && depth < MAX_NESTED_DEPTH
        const canExpandArr = canExpandAsArray(arr) && depth < MAX_NESTED_DEPTH
        const canExpand = canExpandObj || canExpandArr

        // Update a nested field within this object
        const updateNestedFieldLocal = useCallback(
            (nestedKey: string, newValue: string) => {
                const currentObj = tryParseAsObject(value) || {}

                // Try to parse the new value as JSON, otherwise use as string
                let parsedNewValue: unknown = newValue
                try {
                    parsedNewValue = JSON.parse(newValue)
                } catch {
                    // Keep as string
                }

                const updatedObj = {...currentObj, [nestedKey]: parsedNewValue}
                onChange(JSON.stringify(updatedObj))
            },
            [value, onChange],
        )

        // Update an array item by index
        const updateArrayItemLocal = useCallback(
            (index: number, newValue: string) => {
                const currentArr = tryParseAsArray(value) || []

                // Try to parse the new value as JSON, otherwise use as string
                let parsedNewValue: unknown = newValue
                try {
                    parsedNewValue = JSON.parse(newValue)
                } catch {
                    // Keep as string
                }

                const updatedArr = [...currentArr]
                updatedArr[index] = parsedNewValue
                onChange(JSON.stringify(updatedArr))
            },
            [value, onChange],
        )

        const isNestedObject = canExpandValue(tryParseAsObject(value))
        const isArray = canExpandAsArray(tryParseAsArray(value))

        // Determine if we should show as last (for tree line styling)
        const shouldShowAsLast = isLast && !isExpanded

        // If expanded and can expand as object, show nested fields
        if (isExpanded && canExpandObj && obj) {
            const keys = Object.keys(obj).sort()
            return (
                <div className={clsx(classes.treeNode, isLast && "last")}>
                    <div className={classes.treeNodeLabel}>
                        {/* Field name row with collapse button */}
                        <div className="flex items-center justify-between">
                            <Text strong className="text-xs text-gray-600">
                                {fieldName}
                            </Text>
                            <Button
                                type="text"
                                size="small"
                                className="!px-1 !h-5 text-xs text-gray-500"
                                onClick={() => setIsExpanded(false)}
                            >
                                <CaretDown size={12} className="mr-1" />
                                Collapse
                            </Button>
                        </div>
                    </div>
                    {/* Nested fields */}
                    {keys.map((nestedKey, index) => {
                        const nestedValue = getNestedValue(obj, nestedKey)
                        return (
                            <NestedFieldEditor
                                key={nestedKey}
                                fieldKey={`${fieldKey}.${nestedKey}`}
                                fieldName={nestedKey}
                                value={nestedValue}
                                onChange={(newVal) => updateNestedFieldLocal(nestedKey, newVal)}
                                depth={depth + 1}
                                isLast={index === keys.length - 1}
                            />
                        )
                    })}
                </div>
            )
        }

        // If expanded and can expand as array, show array items
        if (isExpanded && canExpandArr && arr) {
            return (
                <div className={clsx(classes.treeNode, isLast && "last")}>
                    <div className={classes.treeNodeLabel}>
                        {/* Field name row with collapse button */}
                        <div className="flex items-center justify-between">
                            <Text strong className="text-xs text-gray-600">
                                {fieldName}
                                <span className="text-gray-400 font-normal ml-1">
                                    [{arr.length} items]
                                </span>
                            </Text>
                            <Button
                                type="text"
                                size="small"
                                className="!px-1 !h-5 text-xs text-gray-500"
                                onClick={() => setIsExpanded(false)}
                            >
                                <CaretDown size={12} className="mr-1" />
                                Collapse
                            </Button>
                        </div>
                    </div>
                    {/* Array items */}
                    {arr.map((_, index) => {
                        const itemValue = getArrayItemValue(arr, index)
                        return (
                            <NestedFieldEditor
                                key={index}
                                fieldKey={`${fieldKey}[${index}]`}
                                fieldName={`Item ${index + 1}`}
                                value={itemValue}
                                onChange={(newVal) => updateArrayItemLocal(index, newVal)}
                                depth={depth + 1}
                                isLast={index === arr.length - 1}
                            />
                        )
                    })}
                </div>
            )
        }

        // Show field name row with optional expand button, then editor below
        return (
            <div className={clsx(classes.treeNode, shouldShowAsLast && "last")}>
                <div className={classes.treeNodeLabel}>
                    {/* Field name row with expand button */}
                    <div className="flex items-center justify-between">
                        <Text strong className="text-xs text-gray-600">
                            {fieldName}
                            {isArray && (
                                <span className="text-gray-400 font-normal ml-1">
                                    [{arr?.length || 0} items]
                                </span>
                            )}
                        </Text>
                        {canExpand && (
                            <Button
                                type="text"
                                size="small"
                                className="!px-1 !h-5 text-xs text-gray-500"
                                onClick={() => setIsExpanded(true)}
                            >
                                <CaretRight size={12} className="mr-1" />
                                Expand
                            </Button>
                        )}
                    </div>
                    {/* Editor */}
                    <div className={classes.treeNodeContent}>
                        <SharedEditor
                            key={fieldKey}
                            initialValue={value}
                            handleChange={onChange}
                            editorType="border"
                            className="overflow-hidden"
                            disableDebounce
                            editorProps={
                                isNestedObject
                                    ? {
                                          codeOnly: true,
                                          language: "json",
                                          showLineNumbers: true,
                                      }
                                    : undefined
                            }
                        />
                    </div>
                </div>
            </div>
        )
    },
)

NestedFieldEditor.displayName = "NestedFieldEditor"

export default NestedFieldEditor
