/**
 * FieldsTagsEditor - Tag-based editor for JSON field paths
 *
 * This component provides an add/remove interface for managing JSON field paths.
 * Users can:
 * - Add fields manually using an input field (supports dot notation for nested paths)
 * - Remove fields by clicking the X button on tags
 * - Detect fields from the selected testcase using a dedicated button
 *
 * The component also displays a non-removable "overall" field representing
 * the aggregate result across all fields.
 *
 * Auto-detection behavior:
 * - When a testcase is loaded and no fields are configured, fields are auto-detected
 */

import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {PlusOutlined, SearchOutlined} from "@ant-design/icons"
import {Button, Form, Input, Tag, Tooltip, Typography} from "antd"
import type {FormInstance} from "antd/es/form"
import {useAtomValue} from "jotai"

import {extractJsonPaths, safeParseJson} from "@/oss/lib/helpers/extractJsonPaths"

import {playgroundSelectedTestcaseAtom} from "./state/atoms"

const {Text} = Typography

interface FieldsTagsEditorProps {
    value?: string[]
    onChange?: (value: string[]) => void
    form?: FormInstance
    name?: string | string[]
    correctAnswerKey?: string
}

/**
 * Tag-based editor for managing JSON field paths with add/remove functionality.
 * Includes "Detect from testcase" feature to auto-populate fields.
 */
export const FieldsTagsEditor: React.FC<FieldsTagsEditorProps> = ({
    value = [],
    onChange,
    form,
    correctAnswerKey = "correct_answer",
}) => {
    const [inputValue, setInputValue] = useState("")
    // Track if we've already auto-detected to avoid re-triggering
    const hasAutoDetectedRef = useRef(false)

    // Read the selected testcase from the playground atom
    const testcaseSelection = useAtomValue(playgroundSelectedTestcaseAtom)
    const testcase = testcaseSelection?.testcase

    // Watch the correct_answer_key from form to react to changes
    // Using Form.useWatch instead of form.getFieldValue for reactivity
    const formCorrectAnswerKey = Form.useWatch(["parameters", "correct_answer_key"], form)
    const effectiveKey = formCorrectAnswerKey || correctAnswerKey

    // Check if we can detect fields from testcase
    const canDetectFields = useMemo(() => {
        if (!testcase) return false
        const groundTruthValue = testcase[effectiveKey]
        if (!groundTruthValue) return false
        const parsed = safeParseJson(groundTruthValue)
        return parsed !== null
    }, [testcase, effectiveKey])

    // Extract available fields from the testcase
    const detectableFields = useMemo(() => {
        if (!testcase) return []
        const groundTruthValue = testcase[effectiveKey]
        if (!groundTruthValue) return []
        const parsed = safeParseJson(groundTruthValue)
        if (!parsed) return []
        return extractJsonPaths(parsed)
    }, [testcase, effectiveKey])

    // Auto-detect fields when testcase is loaded and no fields are configured
    useEffect(() => {
        // Only auto-detect if:
        // 1. We haven't already auto-detected
        // 2. There are no user-defined fields
        // 3. We can detect fields from the testcase
        if (!hasAutoDetectedRef.current && value.length === 0 && detectableFields.length > 0) {
            hasAutoDetectedRef.current = true
            onChange?.(detectableFields)
        }
    }, [detectableFields, value.length, onChange])

    // Handle adding a new field
    const handleAddField = useCallback(() => {
        const trimmed = inputValue.trim()
        if (!trimmed) return

        // Don't add duplicates
        if (value.includes(trimmed)) {
            setInputValue("")
            return
        }

        // Don't allow reserved field names
        if (trimmed === "aggregate_score") {
            setInputValue("")
            return
        }

        onChange?.([...value, trimmed])
        setInputValue("")
    }, [inputValue, value, onChange])

    // Handle removing a field
    const handleRemoveField = useCallback(
        (fieldToRemove: string) => {
            onChange?.(value.filter((f) => f !== fieldToRemove))
        },
        [value, onChange],
    )

    // Handle detecting fields from testcase (replaces existing fields)
    const handleDetectFields = useCallback(() => {
        if (detectableFields.length > 0) {
            onChange?.(detectableFields)
        }
    }, [detectableFields, onChange])

    // Handle Enter key in input
    const handleInputKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault()
                handleAddField()
            }
        },
        [handleAddField],
    )

    // Generate tooltip for disabled detect button
    const detectButtonTooltip = useMemo(() => {
        if (!testcase) {
            return "Select a testcase first to detect fields"
        }
        if (!canDetectFields) {
            return `No JSON object found in the "${effectiveKey}" column`
        }
        return `Detect ${detectableFields.length} field(s) from testcase (replaces current fields)`
    }, [testcase, canDetectFields, effectiveKey, detectableFields.length])

    return (
        <div className="flex flex-col gap-3">
            {/* Field Tags Display */}
            <div className="flex flex-wrap gap-2 p-3 rounded-md border border-solid border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] min-h-[48px]">
                {/* Non-removable aggregate_score tag */}
                <Tooltip title="Aggregate score across all fields (auto-generated)">
                    <Tag color="success" className="font-mono text-[13px] !m-0 font-medium">
                        aggregate_score
                    </Tag>
                </Tooltip>

                {/* User-defined field tags */}
                {value.map((field) => (
                    <Tag
                        key={field}
                        closable
                        onClose={() => handleRemoveField(field)}
                        className="flex items-center font-mono text-[13px] !m-0"
                    >
                        {field}
                    </Tag>
                ))}

                {/* Empty state message */}
                {value.length === 0 && (
                    <Text className="text-[var(--ant-color-text-secondary)] text-[13px]">
                        Add fields to compare or detect them from a testcase
                    </Text>
                )}
            </div>

            {/* Add Field Input */}
            <div className="flex gap-2">
                <Input
                    className="flex-1 font-mono"
                    placeholder="Add field (e.g., name or user.address.city)"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    suffix={
                        <Tooltip title="Use dot notation for nested fields (e.g., user.name)">
                            <Text type="secondary" className="text-[11px]">
                                ?
                            </Text>
                        </Tooltip>
                    }
                />
                <Button
                    icon={<PlusOutlined />}
                    onClick={handleAddField}
                    disabled={!inputValue.trim()}
                >
                    Add
                </Button>
            </div>

            {/* Actions Row */}
            <div className="flex items-center justify-between">
                <Text className="text-xs text-[var(--ant-color-text-secondary)]">
                    Each field creates a column with value 0 (no match) or 1 (match)
                </Text>

                <Tooltip title={detectButtonTooltip}>
                    <Button
                        type="default"
                        size="small"
                        icon={<SearchOutlined />}
                        onClick={handleDetectFields}
                        disabled={!canDetectFields}
                    >
                        Detect from testcase
                    </Button>
                </Tooltip>
            </div>
        </div>
    )
}

export default FieldsTagsEditor
