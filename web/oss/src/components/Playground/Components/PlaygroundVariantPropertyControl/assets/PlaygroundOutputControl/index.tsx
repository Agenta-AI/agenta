import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Button, Modal, Tooltip, Typography} from "antd"
import clsx from "clsx"

import {EditorProvider, useLexicalComposerContext} from "@/oss/components/Editor/Editor"
import {
    $getEditorCodeAsString,
    constructJsonFromSchema,
} from "@/oss/components/Editor/plugins/code/plugins/RealTimeValidationPlugin"
import {tryParsePartialJson} from "@/oss/components/Editor/plugins/code/tryParsePartialJson"
import {CompoundMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"

import SharedEditor from "../../../SharedEditor"
import {RenderFunctions} from "../../types"
import MultiSelectControl from "../MultiSelectControl"
import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControlWrapper"

const PlaygroundOutputControl = ({
    withTooltip,
    metadata,
    value,
    handleChange,
    promptName,
    viewOnly,
    ...rest
}: {
    withTooltip: boolean
    promptName: string
    metadata: CompoundMetadata
    handleChange: Parameters<NonNullable<RenderFunctions["compound"]>>[0]["handleChange"]
    value: Parameters<NonNullable<RenderFunctions["compound"]>>[0]["value"]
}) => {
    const [editor] = useLexicalComposerContext()
    const [modalState, setModalState] = useState(false)
    const selectedOption = metadata.options.find((option) => option.value === value?.type)
    const schema = value?.json_schema
    const {variantId: controlVariantId, propertyId: controlPropertyId} = (rest || {}) as any

    const toPrettyString = useCallback((v: any): string => {
        if (v == null) return ""
        if (typeof v === "string") return v
        try {
            return JSON.stringify(v, null, 2)
        } catch {
            return String(v)
        }
    }, [])

    const [structuredOutputState, setStructuredOutputState] = useState<string>(() => {
        if (schema) return toPrettyString(schema)
        const seed = constructJsonFromSchema(selectedOption?.config.json_schema, {
            name: "Schema",
            description: "A description of the schema",
            strict: false,
            schema: {type: "object", properties: {}},
        })
        return toPrettyString(seed)
    })

    useEffect(() => {
        // Seed once when switching to json_schema and there is no existing value
        if (!!selectedOption?.config?.json_schema && !schema) {
            const obj = constructJsonFromSchema(selectedOption.config.json_schema, {
                name: "MySchema",
                description: "A description of the schema",
                strict: false,
                schema: {type: "object", properties: {}},
            })
            const pretty = toPrettyString(obj)
            if (pretty && pretty !== structuredOutputState) {
                setStructuredOutputState(pretty)
            }
        }
    }, [selectedOption?.config?.json_schema, schema, structuredOutputState, toPrettyString])

    useEffect(() => {
        // Sync only when upstream value is present
        if (value?.json_schema != null) {
            const pretty = toPrettyString(value.json_schema)
            if (pretty !== structuredOutputState) {
                setStructuredOutputState(pretty)
            }
        }
    }, [value?.json_schema, toPrettyString, structuredOutputState])

    useEffect(() => {
        if (selectedOption?.value === "json_schema") {
            if (!value?.json_schema) {
                setModalState(true)
            }
        }
    }, [selectedOption?.value])

    // Ensure modal opens when switching to json_schema regardless of seed presence
    const prevTypeRef = useRef<string | undefined>(value?.type)
    useEffect(() => {
        const prev = prevTypeRef.current
        if (value?.type === "json_schema" && prev !== "json_schema") {
            console.debug("[OutputControl] type transition -> json_schema; opening modal")
            setModalState(true)
        }
        prevTypeRef.current = value?.type
    }, [value?.type])

    // One-shot global fail-safe to reopen modal after possible remounts
    useEffect(() => {
        const flag = (window as any).__pgOpenJsonSchemaOnce
        // Relax match to variant-level to avoid unstable propertyId mismatches
        if (flag && value?.type === "json_schema" && flag === (controlVariantId || true)) {
            console.debug("[OutputControl] open via global flag (variant)", {
                variant: controlVariantId,
            })
            setModalState(true)
            ;(window as any).__pgOpenJsonSchemaOnce = null
        }
    }, [controlVariantId, controlPropertyId, value?.type])

    const saveChanges = useCallback(() => {
        editor.read(() => {
            const test = $getEditorCodeAsString(editor)

            setModalState(false)
            // Commit json_schema type and schema together
            handleChange({
                type: "json_schema",
                json_schema: tryParsePartialJson(test),
            })
        })
    }, [structuredOutputState])

    const correctedStructuredOutput = useMemo(() => {
        try {
            const partial = JSON.parse(structuredOutputState)
            return partial
        } catch (err) {
            const partial = tryParsePartialJson(structuredOutputState)
            return partial
        }
    }, [structuredOutputState])

    return (
        <PlaygroundVariantPropertyControlWrapper
            className={clsx([
                "flex !flex-row !gap-0 mt-2",
                {
                    "[&_.ant-select-selector]:!rounded-r-none": !!correctedStructuredOutput,
                    "[&_.ant-btn]:!rounded-l-none": !!correctedStructuredOutput,
                },
            ])}
            viewOnly
        >
            <Tooltip title={"Output schema"}>
                <div>
                    <MultiSelectControl
                        label={metadata.title || ""}
                        options={metadata.options}
                        value={value?.type}
                        disabled={viewOnly}
                        onChange={(type) => {
                            if (type === "json_schema") {
                                const jsonOpt = metadata.options.find(
                                    (o: any) => o.value === "json_schema",
                                ) as any
                                const seed =
                                    value?.json_schema ??
                                    constructJsonFromSchema(jsonOpt?.config?.json_schema, {
                                        name: "Schema",
                                        description: "A description of the schema",
                                        strict: false,
                                        schema: {type: "object", properties: {}},
                                    })
                                const pretty = toPrettyString(seed)
                                if (pretty)
                                    setStructuredOutputState(pretty)
                                    // Use variant-level key to survive propertyId churn on first write
                                ;(window as any).__pgOpenJsonSchemaOnce = controlVariantId || true

                                // Open modal immediately so it's not lost on re-mount
                                setModalState(true)
                                // Commit locally to mark draft and reflect selection
                                handleChange({
                                    type: "json_schema",
                                    json_schema: tryParsePartialJson(pretty),
                                })
                                return
                            }
                            handleChange({type})
                        }}
                        className={clsx([
                            "[&.ant-select-sm]:h-[24px] [&_.ant-select-selection-item]:!text-[12px]",
                            "[&.ant-select-sm]:!w-fit",
                            "z-[1] hover:z-[2]",
                        ])}
                        description={metadata.description}
                        withTooltip={withTooltip}
                        showSearch={false}
                        prefix={"Output type:"}
                    />
                </div>
            </Tooltip>
            {!!correctedStructuredOutput && value?.type === "json_schema" ? (
                <Button
                    size="small"
                    className="-ml-[1px] z-[1] hover:z-[2]"
                    onClick={() => setModalState(true)}
                    disabled={viewOnly}
                >
                    {correctedStructuredOutput?.name || "Unnamed"}
                </Button>
            ) : null}
            <Modal
                title="Structured output"
                open={modalState}
                onCancel={() => {
                    setModalState(false)
                    // Keep current local draft selection; user can switch back explicitly
                }}
                classNames={{
                    content: "max-h-[80dvh] overflow-hidden flex flex-col",
                    body: "flex flex-col grow shrink-1 overflow-y-auto",
                }}
                onOk={saveChanges}
            >
                <Typography.Text>
                    Define the JSON schema for the structured output of the prompt:{" "}
                    <b className="capitalize">{promptName || "no name"}</b>
                </Typography.Text>
                <PlaygroundVariantPropertyControlWrapper className="w-full max-w-full overflow-y-auto mt-2 flex [&_>_div]:!w-auto [&_>_div]:!grow">
                    <div className="flex flex-col w-full gap-1 mb-2 [&_.agenta-shared-editor]:box-border">
                        <SharedEditor
                            initialValue={structuredOutputState}
                            editorProps={{
                                codeOnly: true,
                                noProvider: true,
                                validationSchema: selectedOption?.config?.json_schema,
                            }}
                            editorType="borderless"
                            className="mt-2"
                            state="filled"
                        />
                    </div>
                </PlaygroundVariantPropertyControlWrapper>
            </Modal>
        </PlaygroundVariantPropertyControlWrapper>
    )
}

const PlaygroundOutputControlWrapper = (props: {className?: string; children: React.ReactNode}) => {
    return (
        <EditorProvider className="!border-none" codeOnly showToolbar={false} enableTokens={false}>
            <PlaygroundOutputControl {...props} />
        </EditorProvider>
    )
}
export default PlaygroundOutputControlWrapper
