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

import {CloseOutlined, PlusOutlined, SearchOutlined} from "@ant-design/icons"
import {Button, Input, Space, Tag, theme, Tooltip, Typography} from "antd"
import type {FormInstance} from "antd/es/form"
import {useAtomValue} from "jotai"
import {createUseStyles} from "react-jss"

import {extractJsonPaths, safeParseJson} from "@/oss/lib/helpers/extractJsonPaths"
import type {JSSTheme} from "@/oss/lib/Types"

import {playgroundSelectedTestcaseAtom} from "./state/atoms"

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: 12,
    },
    tagsContainer: {
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: 12,
        borderRadius: 6,
        border: `1px solid ${theme.colorBorder}`,
        backgroundColor: theme.colorBgContainer,
        minHeight: 48,
    },
    fieldTag: {
        display: "flex",
        alignItems: "center",
        fontFamily: "monospace",
        fontSize: 13,
        margin: 0,
    },
    matchRatioTag: {
        fontFamily: "monospace",
        fontSize: 13,
        margin: 0,
        fontWeight: 500,
    },
    addFieldRow: {
        display: "flex",
        gap: 8,
    },
    addInput: {
        flex: 1,
        fontFamily: "monospace",
    },
    actionsRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    helperText: {
        fontSize: 12,
        color: theme.colorTextSecondary,
    },
    emptyMessage: {
        color: theme.colorTextSecondary,
        fontSize: 13,
    },
}))

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
    const classes = useStyles()
    const {token} = theme.useToken()
    const [inputValue, setInputValue] = useState("")
    // Track if we've already auto-detected to avoid re-triggering
    const hasAutoDetectedRef = useRef(false)

    // Read the selected testcase from the playground atom
    const testcaseSelection = useAtomValue(playgroundSelectedTestcaseAtom)
    const testcase = testcaseSelection?.testcase

    // Get the correct_answer_key from form if available
    const formCorrectAnswerKey = form?.getFieldValue(["settings_values", "correct_answer_key"])
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
        <div className={classes.container}>
            {/* Field Tags Display */}
            <div className={classes.tagsContainer}>
                {/* Non-removable aggregate_score tag */}
                <Tooltip title="Aggregate score across all fields (auto-generated)">
                    <Tag color="success" className={classes.matchRatioTag}>
                        aggregate_score
                    </Tag>
                </Tooltip>

                {/* User-defined field tags */}
                {value.map((field) => (
                    <Tag
                        key={field}
                        closable
                        onClose={() => handleRemoveField(field)}
                        className={classes.fieldTag}
                    >
                        {field}
                    </Tag>
                ))}

                {/* Empty state message */}
                {value.length === 0 && (
                    <Text className={classes.emptyMessage}>
                        Add fields to compare or detect them from a testcase
                    </Text>
                )}
            </div>

            {/* Add Field Input */}
            <div className={classes.addFieldRow}>
                <Input
                    className={classes.addInput}
                    placeholder="Add field (e.g., name or user.address.city)"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    suffix={
                        <Tooltip title="Use dot notation for nested fields (e.g., user.name)">
                            <Text type="secondary" style={{fontSize: 11}}>
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
            <div className={classes.actionsRow}>
                <Text className={classes.helperText}>
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
