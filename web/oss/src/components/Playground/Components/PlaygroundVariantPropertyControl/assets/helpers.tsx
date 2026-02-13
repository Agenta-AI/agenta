import {getMetadataLazy} from "@agenta/entities/legacyAppRevision"
import {Tooltip, Typography} from "antd"
import dynamic from "next/dynamic"

import {EnhancedConfigValue} from "@/oss/lib/shared/variant/genericTransformer/types"

import {findPropertyInObject} from "../../../hooks/usePlayground/assets/helpers"
import PlaygroundTool from "../../PlaygroundTool"
import {ArrayItemValue, RenderFunctions} from "../types"

import BooleanControl from "./BooleanControl"
import GroupTab from "./GroupTab"
import MinMaxControl from "./MinMaxControl"
import MultiSelectControl from "./MultiSelectControl"
import PlaygroundOutputControl from "./PlaygroundOutputControl"
import PlaygroundVariantPropertyControlWrapper from "./PlaygroundVariantPropertyControlWrapper"
import PromptMessageContent from "./PromptMessageContent"
import SimpleDropdownSelect from "./SimpleDropdownSelect"
import SimpleInput from "./SimpleInput"
import TextControl from "./TextControl"

const SelectLLMProvider = dynamic(() => import("@/oss/components/SelectLLMProvider"), {ssr: false})

const derivePlainValue = (node: any): any => {
    if (node === null || node === undefined) return node
    if (Array.isArray(node)) {
        return node.map((item) => derivePlainValue(item))
    }

    if (typeof node !== "object") {
        return node
    }

    const rawValue = (node as any).value

    if (Array.isArray(rawValue)) {
        return rawValue.map((item: any) => derivePlainValue(item))
    }

    const plainChildren: Record<string, any> = {}
    for (const [key, value] of Object.entries(node)) {
        if (key === "value" || key.startsWith("__")) continue
        plainChildren[key] = derivePlainValue(value)
    }

    if (Object.keys(plainChildren).length > 0) {
        return plainChildren
    }

    if (rawValue !== undefined) {
        return rawValue
    }

    return node
}

const cloneEnhanced = <T,>(value: T): T => {
    if (typeof structuredClone === "function") {
        return structuredClone(value)
    }

    return JSON.parse(JSON.stringify(value))
}

const updateArrayItem = (
    array: EnhancedConfigValue<ArrayItemValue>[],
    id: string,
    newValue: any,
    handleChange: (v: any, event?: any, propertyId?: string) => void,
    targetPropertyId?: string,
) => {
    const newArray = [...array]
    const index = array.findIndex((v) => v.__id === id)
    if (index === -1) return

    if (targetPropertyId) {
        const itemClone = cloneEnhanced(newArray[index])
        const targetNode = findPropertyInObject(itemClone, targetPropertyId)

        if (targetNode && typeof targetNode === "object") {
            if ("content" in targetNode && targetNode.content && "value" in targetNode.content) {
                ;(targetNode.content as any).value = newValue
            } else if ("value" in targetNode) {
                ;(targetNode as any).value = newValue
            }

            if ("value" in itemClone) {
                ;(itemClone as any).value = derivePlainValue(itemClone)
            }

            newArray[index] = itemClone
            handleChange({value: newArray}, undefined, targetPropertyId)
            return
        }
    }

    newArray[index] = {...newArray[index], value: newValue}
    handleChange({value: newArray})
}

export const renderMap: RenderFunctions = {
    number: ({
        disabled,
        withTooltip,
        metadata,
        value,
        handleChange,
        placeholder,
        allowClear,
        disableClear,
        className,
    }) => {
        return (
            <MinMaxControl
                label={metadata.title || ""}
                value={value}
                onChange={handleChange}
                min={metadata.min}
                max={metadata.max}
                step={metadata.isInteger ? 1 : 0.1}
                withTooltip={withTooltip}
                description={metadata.description}
                disabled={disabled}
                placeholder={placeholder}
                allowClear={allowClear}
                disableClear={disableClear}
                className={className}
            />
        )
    },

    boolean: ({
        withTooltip,
        metadata,
        value,
        handleChange,
        disabled,
        as,
        allowClear,
        disableClear,
    }) => {
        if (as === "GroupTab") {
            return (
                <GroupTab
                    label={metadata.title || ""}
                    value={value}
                    onChange={handleChange}
                    disabled={disabled}
                    options={metadata.options}
                    allowClear={allowClear}
                    disableClear={disableClear}
                />
            )
        }

        return (
            <BooleanControl
                description={metadata.description}
                label={metadata.title || ""}
                value={value}
                onChange={handleChange}
                disabled={disabled}
            />
        )
    },

    string: ({
        placeholder,
        disabled,
        withTooltip,
        metadata,
        value,
        handleChange,
        as,
        className,
        allowClear,
        view,
        mode,
        disableClear,
        ...rest
    }) => {
        if (metadata.options) {
            if (as === "SimpleDropdownSelect") {
                return (
                    <SimpleDropdownSelect
                        value={typeof value === "string" ? value : value?.value || ""}
                        options={metadata.options}
                        onChange={handleChange}
                        placeholder={metadata.description}
                        className={className}
                        description={metadata.description}
                        withTooltip={withTooltip}
                        disabled={disabled}
                    />
                )
            }

            if (as === "GroupTab") {
                return (
                    <GroupTab
                        label={metadata.title || ""}
                        value={value}
                        onChange={handleChange}
                        disabled={disabled}
                        options={metadata.options}
                    />
                )
            }

            if (metadata.title === "Model") {
                return (
                    <SelectLLMProvider
                        showGroup
                        showAddProvider
                        showCustomSecretsOnOptions
                        options={metadata.options}
                        value={value}
                        onChange={handleChange}
                        disabled={disabled}
                        className="my-4"
                    />
                )
            }

            return (
                <MultiSelectControl
                    label={metadata.title || ""}
                    options={metadata.options}
                    value={value}
                    onChange={handleChange}
                    description={metadata.description}
                    withTooltip={withTooltip}
                    disabled={disabled}
                    mode={mode}
                    allowClear={allowClear ?? (metadata as any).nullable ?? false}
                    disableClear={disableClear}
                />
            )
        }

        if (as === "PromptMessageContent") {
            return (
                <PromptMessageContent
                    value={value}
                    placeholder={metadata.description || placeholder}
                    onChange={handleChange}
                    description={metadata.description}
                    withTooltip={withTooltip}
                    view={view}
                    className={className}
                    disabled={disabled}
                />
            )
        } else if (as?.includes("SimpleInput")) {
            const {propertyId, variantId, baseProperty, editorProps, ...props} = rest

            return (
                <SimpleInput
                    {...props}
                    value={value}
                    onChange={handleChange}
                    className={className}
                    view={view}
                    description={metadata.description}
                    label={metadata.title || ""}
                    placeholder={placeholder}
                    disabled={disabled}
                    as={as}
                    editorProps={editorProps}
                />
            )
        }

        return (
            <TextControl
                {...rest}
                metadata={metadata}
                value={value}
                handleChange={handleChange}
                className={className}
                view={view}
                description={metadata.description}
                placeholder={placeholder}
                withTooltip={withTooltip}
                disabled={disabled}
                {...(disabled
                    ? {
                          state: "disabled",
                      }
                    : {})}
            />
        )
    },

    array: (props) => {
        const {disabled, withTooltip, value, handleChange} = props
        if (!Array.isArray(value?.value)) {
            return null
        }

        return (
            <div className="flex flex-col gap-2">
                {value.value.map((item: EnhancedConfigValue<ArrayItemValue>) => {
                    const metadata = getMetadataLazy(item.__metadata)
                    if (!metadata) return null

                    switch (metadata.type) {
                        case "string":
                            return (
                                <div key={item.__id}>
                                    {renderMap.string({
                                        withTooltip,
                                        metadata: metadata,
                                        value: item.value,
                                        disabled,
                                        handleChange: (newValue) => {
                                            updateArrayItem(
                                                value.value,
                                                item.__id,
                                                newValue,
                                                handleChange,
                                            )
                                        },
                                    })}
                                </div>
                            )
                        case "number":
                            return (
                                <div key={item.__id}>
                                    {renderMap.number({
                                        disabled,
                                        withTooltip,
                                        metadata: metadata,
                                        value: item.value,
                                        handleChange: (newValue) => {
                                            updateArrayItem(
                                                value.value,
                                                item.__id,
                                                newValue,
                                                handleChange,
                                            )
                                        },
                                    })}
                                </div>
                            )
                        case "boolean":
                            return (
                                <div key={item.__id}>
                                    {renderMap.boolean({
                                        withTooltip,
                                        disabled,
                                        metadata: metadata,
                                        value: item.value,
                                        handleChange: (newValue) => {
                                            updateArrayItem(
                                                value.value,
                                                item.__id,
                                                newValue,
                                                handleChange,
                                            )
                                        },
                                    })}
                                </div>
                            )
                        case "object":
                            return (
                                <div key={item.__id}>
                                    {renderMap.object({
                                        ...props,
                                        metadata,
                                        value: item.value,
                                        baseProperty: item,
                                        handleChange: (
                                            newValue: any,
                                            event?: any,
                                            targetPropertyId?: string,
                                        ) => {
                                            updateArrayItem(
                                                value.value,
                                                item.__id,
                                                newValue,
                                                handleChange,
                                                targetPropertyId,
                                            )
                                        },
                                    })}
                                </div>
                            )
                        default:
                            return null
                    }
                })}
            </div>
        )
    },

    object: (props) => {
        const metadata = props.metadata
        const objectProperties = metadata.properties
        const withTooltip = props.withTooltip
        const baseProperty = props.baseProperty

        // Check if this is a tool configuration by:
        // 1. Explicit metadata.name === "ToolConfiguration", OR
        // 2. Value structure matches tool patterns (function type with name/description/parameters,
        //    or provider tool types like web_search_preview, code_interpreter, etc.)
        const value = props.value
        const isToolByName = metadata.name === "ToolConfiguration"
        const isToolByStructure =
            value &&
            typeof value === "object" && // OpenAI function tool format
            ((value.type === "function" && value.function && typeof value.function === "object") ||
                // Provider tool types (OpenAI built-in tools)
                value.type === "web_search_preview" ||
                value.type === "code_interpreter" ||
                value.type === "file_search" ||
                value.type === "computer_use_preview" ||
                (typeof value.type === "string" &&
                    (value.type.startsWith("bash_") || value.type.startsWith("web_search_"))) ||
                // Anthropic tool format
                (value.name && value.input_schema) ||
                // Generic tool with type and name
                (value.type && value.name && value.description) ||
                // Google tool format
                "code_execution" in value ||
                "googleSearch" in value)

        if (isToolByName || isToolByStructure) {
            const {handleChange, editorProps, variantId, baseProperty, disabled, value} =
                props as any
            return (
                <PlaygroundTool
                    value={value}
                    variantId={variantId}
                    baseProperty={baseProperty}
                    disabled={disabled}
                    editorProps={{
                        ...(editorProps || {}),
                        handleChange,
                    }}
                />
            )
        }

        return (
            <PlaygroundVariantPropertyControlWrapper>
                <div className="border-0 border-t border-solid border-t-[rgba(5,23,41,0.06)] py-3">
                    {withTooltip ? (
                        <Tooltip title={props.metadata.description}>
                            <Typography.Text className="playground-property-control-label text-[14px] w-fit">
                                {props.metadata.key}
                            </Typography.Text>
                        </Tooltip>
                    ) : (
                        <Typography.Text className="playground-property-control-label text-[14px]">
                            {props.metadata.key}
                        </Typography.Text>
                    )}
                </div>

                <div className="">
                    {Object.entries(objectProperties || {}).map(([key, value]) => {
                        const metadataType = value.type
                        const fnc = renderMap[metadataType as keyof typeof renderMap] as
                            | ((props: any) => React.ReactElement)
                            | undefined

                        return fnc ? (
                            <div key={key}>
                                {fnc({
                                    ...props,
                                    metadata: value,
                                    value: baseProperty?.[key]?.value || props.value?.[key] || "",
                                    handleChange: (newValue: any) => {
                                        props.handleChange(
                                            newValue,
                                            undefined,
                                            baseProperty?.[key]?.__id,
                                        )
                                    },
                                })}
                            </div>
                        ) : null
                    })}
                </div>
            </PlaygroundVariantPropertyControlWrapper>
        )
    },
    compound: (props) => {
        if (props.metadata.options && Array.isArray(props.metadata.options)) {
            return <PlaygroundOutputControl {...props} />
        } else {
            return <Typography.Text>Compound input not implemented</Typography.Text>
        }
    },
} as const
