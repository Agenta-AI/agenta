import {useCallback, useEffect, useMemo, useState} from "react"

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

    const [structuredOutputState, setStructuredOutputState] = useState(
        schema ||
            constructJsonFromSchema(selectedOption?.config.json_schema, {
                name: "Schema",
                description: "A description of the schema",
                strict: false,
                schema: {
                    type: "object",
                    properties: {},
                },
            }),
    )

    useEffect(() => {
        if (!!selectedOption?.config.json_schema && !schema) {
            const obj = constructJsonFromSchema(selectedOption?.config.json_schema, {
                name: "MySchema",
                description: "A description of the schema",
                strict: false,
                schema: {
                    type: "object",
                    properties: {},
                },
            })

            setStructuredOutputState(JSON.stringify(obj, null, 2))
        }
    }, [selectedOption?.config.json_schema])

    useEffect(() => {
        setStructuredOutputState(value?.json_schema)
    }, [value?.json_schema])

    useEffect(() => {
        if (selectedOption?.value === "json_schema") {
            if (!value?.json_schema) {
                setModalState(true)
            }
        }
    }, [selectedOption?.value])

    const saveChanges = useCallback(() => {
        editor.read(() => {
            const test = $getEditorCodeAsString(editor)

            setModalState(false)
            handleChange({
                type: selectedOption?.value,
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
                    "[&_.ant-select-selector]:!rounded-r-none": correctedStructuredOutput?.name,
                    "[&_.ant-btn]:!rounded-l-none": correctedStructuredOutput?.name,
                },
            ])}
        >
            <Tooltip title={"Output schema"}>
                <div>
                    <MultiSelectControl
                        label={metadata.title || ""}
                        options={metadata.options}
                        value={value?.type}
                        onChange={(type) =>
                            handleChange({
                                type,
                            })
                        }
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
            {correctedStructuredOutput?.name ? (
                <Button
                    size="small"
                    className="-ml-[1px] z-[1] hover:z-[2]"
                    onClick={() => setModalState(true)}
                >
                    {correctedStructuredOutput.name}
                </Button>
            ) : null}
            <Modal
                title="Structured output"
                open={modalState}
                onCancel={() => {
                    setModalState(false)
                    setStructuredOutputState(schema || structuredOutputState)
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
                                validationSchema: selectedOption?.config.json_schema,
                            }}
                            editorType="borderless"
                            className="mt-2"
                            state="filled"
                        />
                    </div>
                    <div className=""></div>
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
