import React, {useCallback, useEffect, useMemo, useRef} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {TOGGLE_MARKDOWN_VIEW, EditorProvider, useLexicalComposerContext} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

export interface VariableControlAdapterProps {
    entityId: string
    rowId: string
    variableKey: string
    className?: string
    as?: string
    view?: string
    placeholder?: string
    disabled?: boolean
    /** App type for custom app variable gating (injected by OSS) */
    appType?: string
    // forwarded to SimpleInput when `as` includes "SimpleInput"
    editorProps?: Record<string, unknown>
    headerActions?: React.ReactNode
    onMarkdownToggleReady?: (toggle: (() => void) | null) => void
    collapsed?: boolean
    /** Ref attached to the outer container — used for overflow detection by CollapseToggleButton */
    containerRef?: React.RefObject<HTMLDivElement | null>
}

const MarkdownToggleRegistrar: React.FC<{
    onMarkdownToggleReady?: (toggle: (() => void) | null) => void
}> = ({onMarkdownToggleReady}) => {
    const [editor] = useLexicalComposerContext()
    const callbackRef = useRef<typeof onMarkdownToggleReady>(onMarkdownToggleReady)
    const toggleRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        callbackRef.current = onMarkdownToggleReady
    }, [onMarkdownToggleReady])

    useEffect(() => {
        toggleRef.current = () => editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
        callbackRef.current?.(toggleRef.current)

        return () => {
            callbackRef.current?.(null)
            toggleRef.current = null
        }
    }, [editor])

    return null
}

/**
 * VariableControlAdapter
 *
 * Adapter for rendering and editing generation variables using the same
 * control renderers as PlaygroundVariantPropertyControl, without touching
 * prompt configuration state. Reads from normalized generation selectors
 * and writes to normalized input rows.
 */
const VariableControlAdapter: React.FC<VariableControlAdapterProps> = ({
    rowId,
    variableKey,
    className,
    as = "SimpleInput",
    view,
    placeholder,
    disabled,
    appType,
    editorProps,
    headerActions,
    onMarkdownToggleReady,
    collapsed = false,
    containerRef,
}) => {
    // Direct testcase entity access — rowId IS the testcaseId.
    // Uses testcaseMolecule.atoms.cell under the hood (selectAtom with equality check),
    // so this only re-renders when this specific cell value changes.
    const value = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.testcaseCellValue({
                    testcaseId: rowId,
                    column: variableKey,
                }),
            [rowId, variableKey],
        ),
    ) as string
    const variableKeys = useAtomValue(executionItemController.selectors.variableKeys) as string[]
    const name = useMemo(
        () => (variableKeys.includes(variableKey) ? variableKey : undefined),
        [variableKeys, variableKey],
    )

    // Custom app variable gating: disable controls for names not in schema keys
    const schemaKeys = useAtomValue(
        useMemo(() => executionItemController.selectors.schemaInputKeys, []),
    ) as string[]
    const isCustom = appType === "custom"
    const disableForCustom = useMemo(() => {
        const allowedSet = new Set(Array.isArray(schemaKeys) ? schemaKeys : [])
        return Boolean(isCustom && name && !allowedSet.has(name as string))
    }, [isCustom, schemaKeys, name])

    const setCellValue = useSetAtom(executionItemController.actions.setTestcaseCellValue)

    const handleChange = useCallback(
        (nextText: unknown) => {
            const nextVal = typeof nextText === "string" ? nextText : String(nextText ?? "")
            setCellValue({testcaseId: rowId, column: variableKey, value: nextVal})
        },
        [setCellValue, rowId, variableKey],
    )

    const {isComparisonView} = useAtomValue(
        useMemo(() => playgroundController.selectors.playgroundLayout(), []),
    )
    const viewType = isComparisonView ? "comparison" : "single"

    const effectivePlaceholder = placeholder || "Enter a value"
    const editorId = useMemo(
        () => `generation-variable-${rowId}-${variableKey}`,
        [rowId, variableKey],
    )

    return (
        <div ref={containerRef}>
            <EditorProvider
                id={editorId}
                initialValue={value}
                placeholder={effectivePlaceholder}
                showToolbar={false}
                enableTokens={!editorProps?.codeOnly}
                disabled={disabled || disableForCustom}
            >
                <MarkdownToggleRegistrar onMarkdownToggleReady={onMarkdownToggleReady} />
                <SharedEditor
                    id={editorId}
                    noProvider
                    header={
                        <div className="w-full flex items-start justify-between gap-2">
                            <Typography className="playground-property-control-label font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
                                {name}
                            </Typography>
                            {headerActions ? (
                                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                                    {headerActions}
                                </div>
                            ) : null}
                        </div>
                    }
                    key={variableKey}
                    editorType={viewType === "single" && view !== "focus" ? "border" : "borderless"}
                    useAntdInput={false}
                    disableContainerTransition
                    handleChange={handleChange}
                    initialValue={value}
                    value={value}
                    editorClassName={className}
                    placeholder={effectivePlaceholder}
                    disabled={disabled || disableForCustom}
                    className={clsx(
                        "relative flex flex-col gap-1 rounded-[theme(spacing.2)]",
                        {
                            "[&_.agenta-editor-wrapper]:max-h-[calc(8px+calc(3*19.88px))] [&_.agenta-editor-wrapper]:overflow-y-auto [&_.agenta-editor-wrapper]:!mb-0 [&_.agenta-editor-wrapper]:transition-[max-height] [&_.agenta-editor-wrapper]:duration-300":
                                collapsed,
                            "[&_.agenta-editor-wrapper]:max-h-[9999px] [&_.agenta-editor-wrapper]:transition-[max-height] [&_.agenta-editor-wrapper]:duration-300":
                                !collapsed,
                        },
                        viewType === "single" && view !== "focus" ? "" : "bg-transparent",
                        className,
                    )}
                    editorProps={{
                        enableResize: false,
                        boundWidth: true,
                        ...editorProps,
                    }}
                />
            </EditorProvider>
        </div>
    )
}

export default VariableControlAdapter
