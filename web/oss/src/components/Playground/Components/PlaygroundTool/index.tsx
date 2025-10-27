import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Input, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import JSON5 from "json5"
import {v4 as uuidv4} from "uuid"

import {EditorProvider} from "@/oss/components/Editor/Editor"
import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControl/assets/PlaygroundVariantPropertyControlWrapper"
import PromptMessageContentOptions from "../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"
import SharedEditor from "../SharedEditor"

import {TOOL_SCHEMA} from "./assets"

export type ToolFunction = {
    name?: string
    description?: string
    [k: string]: any
}

export type ToolObj = {
    function?: ToolFunction
    [k: string]: any
} | null

export interface PlaygroundToolProps {
    value: unknown
    disabled?: boolean
    variantId: string
    baseProperty?: {__id?: string} & Record<string, any>
    editorProps?: {
        handleChange?: (obj: ToolObj) => void
    }
}

function safeStringify(obj: any): string {
    try {
        return JSON.stringify(obj, null, 2)
    } catch {
        return ""
    }
}

// stable stringify - sorts keys so deep equals is reliable
function stableStringify(input: any): string {
    const seen = new WeakSet()
    function sortKeys(value: any): any {
        if (value && typeof value === "object") {
            if (seen.has(value)) return null // guard against cycles
            seen.add(value)
            if (Array.isArray(value)) return value.map(sortKeys)
            const out: Record<string, any> = {}
            Object.keys(value)
                .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
                .forEach((k) => {
                    out[k] = sortKeys(value[k])
                })
            return out
        }
        return value
    }
    try {
        return JSON.stringify(sortKeys(input))
    } catch {
        return ""
    }
}

function deepEqual(a: any, b: any): boolean {
    return stableStringify(a) === stableStringify(b)
}

function toToolObj(value: unknown): ToolObj {
    try {
        if (typeof value === "string") return value ? (JSON5.parse(value) as ToolObj) : {}
        if (value && typeof value === "object") return value as ToolObj
        return {}
    } catch {
        // Keep last known good
        return {}
    }
}

/**
 * Manages the tool JSON editor state and parsed object snapshot.
 * - Emits onChange only when the canonical object actually changes (deep compare)
 * - Reacts to external prop changes to `initialValue`
 */
function useToolState(
    initialValue: unknown,
    isReadOnly: boolean,
    onChange?: (obj: ToolObj) => void,
) {
    const [toolObj, setToolObj] = useState<ToolObj>(() => toToolObj(initialValue))
    const [editorText, setEditorText] = useState<string>(() => safeStringify(toolObj ?? {}))
    const [editorValid, setEditorValid] = useState(true)

    // Last sent payload to avoid duplicate onChange calls
    const lastSentSerializedRef = useRef<string>(stableStringify(toolObj))

    // Emit to parent when canonical state changes
    useEffect(() => {
        if (isReadOnly || !onChange) return
        const current = stableStringify(toolObj)
        if (current !== lastSentSerializedRef.current) {
            lastSentSerializedRef.current = current
            onChange(toolObj)
        }
    }, [toolObj, onChange, isReadOnly])

    // React to external initialValue changes
    const lastPropValueRef = useRef<string>(stableStringify(toToolObj(initialValue)))
    useEffect(() => {
        const nextParsed = toToolObj(initialValue)
        const nextSerialized = stableStringify(nextParsed)
        if (nextSerialized !== lastPropValueRef.current) {
            lastPropValueRef.current = nextSerialized
            setToolObj(nextParsed)
            setEditorText(safeStringify(nextParsed ?? {}))
            setEditorValid(true)
        }
    }, [initialValue])

    const onEditorChange = useCallback(
        (text: string) => {
            if (isReadOnly) return
            setEditorText(text)
            try {
                const parsed = text ? (JSON5.parse(text) as ToolObj) : {}
                setEditorValid(true)
                setToolObj((prev) => (deepEqual(prev, parsed) ? prev : parsed))
            } catch {
                setEditorValid(false)
            }
        },
        [isReadOnly],
    )

    return {
        toolObj,
        editorText,
        editorValid,
        onEditorChange,
    }
}

/**
 * Header component - isolated to avoid re-creating callbacks unnecessarily
 */
function ToolHeader(props: {
    idForActions: string
    name: string
    desc: string
    editorValid: boolean
    isReadOnly: boolean
    minimized: boolean
    onToggleMinimize: () => void
    onDelete?: () => void
}) {
    const {name, desc, editorValid, isReadOnly, minimized, onToggleMinimize, onDelete} = props

    return (
        <div className={clsx("w-full flex items-center justify-between", "py-1")}>
            <div className="grow">
                <div className="flex flex-col gap-1">
                    <Tooltip
                        trigger={["hover", "focus"]}
                        title={!editorValid ? "Fix JSON errors to edit" : "Function Name"}
                        placement="topLeft"
                    >
                        <Input
                            value={name}
                            variant="borderless"
                            placeholder="Function Name"
                            readOnly
                            disabled={!editorValid}
                        />
                    </Tooltip>

                    <Tooltip
                        trigger={["hover", "focus"]}
                        title={!editorValid ? "Fix JSON errors to edit" : "Function Description"}
                        placement="topLeft"
                    >
                        <Input
                            value={desc}
                            variant="borderless"
                            placeholder="Function Description"
                            readOnly
                            disabled={!editorValid}
                        />
                    </Tooltip>
                </div>
            </div>

            <PromptMessageContentOptions
                id={props.idForActions}
                className="invisible group-hover/item:visible"
                isMessageDeletable={!isReadOnly}
                disabled={isReadOnly}
                minimized={minimized}
                actions={
                    isReadOnly
                        ? undefined
                        : {
                              deleteMessage: onDelete,
                              minimize: onToggleMinimize,
                          }
                }
                hideMarkdownToggle={true}
            />
        </div>
    )
}

const PlaygroundTool: React.FC<PlaygroundToolProps> = ({
    value,
    disabled,
    variantId,
    baseProperty,
    editorProps,
}) => {
    const editorIdRef = useRef(uuidv4())
    const isReadOnly = Boolean(disabled)
    const [minimized, setMinimized] = useState(false)

    const {toolObj, editorText, editorValid, onEditorChange} = useToolState(
        value,
        isReadOnly,
        editorProps?.handleChange,
    )

    useAtomValue(variantByRevisionIdAtomFamily(variantId))
    const appUriInfo = useAtomValue(appUriInfoAtom)
    const setPrompts = useSetAtom(
        useMemo(() => promptsAtomFamily(variantId), [variantId, appUriInfo?.routePath]),
    )

    const deleteMessage = useCallback(() => {
        if (isReadOnly) return
        const id = baseProperty?.__id
        if (!id) {
            console.warn("Cannot delete tool - missing tool property ID")
            return
        }
        setPrompts((prevPrompts: any[] = []) => {
            return prevPrompts.map((prompt: any) => {
                const toolsArr = prompt?.llmConfig?.tools?.value
                if (Array.isArray(toolsArr)) {
                    const updatedTools = toolsArr.filter((tool: any) => tool.__id !== id)
                    if (updatedTools.length !== toolsArr.length) {
                        return {
                            ...prompt,
                            llmConfig: {
                                ...prompt.llmConfig,
                                tools: {
                                    ...prompt.llmConfig?.tools,
                                    value: updatedTools,
                                },
                            },
                        }
                    }
                }
                return prompt
            })
        })
    }, [isReadOnly, baseProperty?.__id, setPrompts])

    return (
        <PlaygroundVariantPropertyControlWrapper
            className={clsx(
                "w-full max-w-full overflow-y-auto flex [&_>_div]:!w-auto [&_>_div]:!grow !my-0",
                {"[_.agenta-shared-editor]:w-full": isReadOnly},
            )}
        >
            <EditorProvider
                className="!border-none"
                codeOnly
                showToolbar={false}
                enableTokens={false}
                id={editorIdRef.current}
            >
                <SharedEditor
                    initialValue={editorText}
                    editorProps={{
                        codeOnly: true,
                        noProvider: true,
                        validationSchema: TOOL_SCHEMA,
                    }}
                    handleChange={(e) => {
                        if (isReadOnly) return
                        onEditorChange(e)
                    }}
                    syncWithInitialValueChanges
                    editorType="border"
                    className={clsx([
                        "mt-2",
                        minimized
                            ? "[&_.agenta-editor-wrapper]:h-[calc(8px+calc(3*19.88px))] [&_.agenta-editor-wrapper]:overflow-y-auto [&_.agenta-editor-wrapper]:!mb-0"
                            : "[&_.agenta-editor-wrapper]:h-fit",
                    ])}
                    state={isReadOnly ? "readOnly" : "filled"}
                    header={
                        <ToolHeader
                            idForActions={editorIdRef.current}
                            name={toolObj?.function?.name ?? ""}
                            desc={toolObj?.function?.description ?? ""}
                            editorValid={editorValid}
                            isReadOnly={isReadOnly}
                            minimized={minimized}
                            onToggleMinimize={() => setMinimized((v) => !v)}
                            onDelete={deleteMessage}
                        />
                    }
                />
            </EditorProvider>
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default PlaygroundTool
