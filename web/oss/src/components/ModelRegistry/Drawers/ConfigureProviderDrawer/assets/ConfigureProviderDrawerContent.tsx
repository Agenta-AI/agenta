import React, {useEffect, useMemo, useState} from "react"

import {SelectLLMProviderBase, type ProviderGroup} from "@agenta/ui/select-llm-provider"
import {capitalize} from "@agenta/ui/select-llm-provider"
import {Plus, WarningCircle} from "@phosphor-icons/react"
import {Button, Form, Input, Typography} from "antd"
import {useWatch} from "antd/lib/form/Form"

import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {PROVIDER_KINDS, PROVIDER_LABELS, SecretDTOProvider} from "@/oss/lib/Types"

import LabelInput from "../../../assets/LabelInput"

import {PROVIDER_FIELDS} from "./constants"
import ModelNameInput from "./ModelNameInput"
import {ConfigureProviderDrawerContentProps} from "./types"

const {Text} = Typography

/** Legacy API slug `mistralai`; canonical slug is {@link SecretDTOProvider.MISTRAL}. Kept on the enum for typing/API parity only. */
const MISTRAL_LEGACY_PROVIDER_SLUG = SecretDTOProvider.MISTRALAI

/** Maps legacy `mistralai` to canonical `mistral` for form + select state; all other slugs unchanged. */
function mistralLegacySlugToCanonical(provider: string): string {
    return provider === MISTRAL_LEGACY_PROVIDER_SLUG ? SecretDTOProvider.MISTRAL : provider
}

/**
 * Optional render metadata you can attach to each PROVIDER_FIELDS item.
 * Example:
 * {
 *   key: "vertexCredentials",
 *   label: "Vertex Credentials (JSON)",
 *   model: ["vertex_ai"],
 *   attributes: { kind: "json", rows: 10, monospace: true, strict: true }
 * }
 */
type FieldAttributes =
    | {kind: "text"; type?: "text" | "password" | "url"; inputType?: "text" | "password" | "url"}
    | {kind: "textarea"; rows?: number; monospace?: boolean}
    | {kind: "json"; rows?: number; monospace?: boolean; strict?: boolean}

interface FieldWithAttributes {
    attributes?: FieldAttributes
    key: string
    label: string
    placeholder?: string
    required?: boolean
    model?: string[]
    note?: string
}

/** Render control based on field.attributes */
const renderControl = (field: FieldWithAttributes, isRequired?: boolean) => {
    const a = field.attributes

    if (!a || a.kind === "text") {
        // Keep your existing single-line input
        return (
            <LabelInput
                label={`${field.label}${isRequired ? " *" : ""}`}
                placeholder={field.placeholder}
                type={a?.type ?? a?.inputType ?? "text"}
            />
        )
    }

    if (a.kind === "textarea") {
        return (
            <div className="flex flex-col gap-1">
                <Text className="font-medium">
                    {field.label}
                    {isRequired ? <span aria-hidden> *</span> : null}
                </Text>
                <Input.TextArea
                    placeholder={field.placeholder}
                    rows={a.rows ?? 6}
                    className={a.monospace ? "font-mono" : undefined}
                    spellCheck={false}
                    autoComplete="off"
                />
            </div>
        )
    }

    // a.kind === "json"
    return (
        <div className="flex flex-col gap-1">
            <Text className="font-medium">
                {field.label}
                {isRequired ? <span aria-hidden> *</span> : null}
            </Text>
            <Input.TextArea
                placeholder={field.placeholder ?? '{\n  "type": "service_account",\n  ...\n}'}
                rows={a.rows ?? 10}
                className={a.monospace !== false ? "font-mono" : undefined}
                spellCheck={false}
                autoComplete="off"
            />
        </div>
    )
}

const ConfigureProviderDrawerContent = ({
    form,
    onClose,
    selectedProvider,
}: ConfigureProviderDrawerContentProps) => {
    const [errorMessage, setErrorMessage] = useState("")
    const {handleModifyCustomVaultSecret} = useVaultSecret()

    const standardProviders = useMemo(() => [...Object.values(SecretDTOProvider)], [])
    const customProviders = useMemo(() => ["azure", "bedrock", "vertex_ai", "custom"], [])
    const validProviders = useMemo(
        () => [...customProviders, ...standardProviders],
        [standardProviders, customProviders],
    )
    const defaultProviderNames = useMemo(
        () => new Set(standardProviders.map((provider) => provider.toLowerCase())),
        [standardProviders],
    )

    // Build provider options for SelectLLMProviderBase
    const providerOptions = useMemo<ProviderGroup[]>(() => {
        // MistralAI (legacy slug) is not shown in the UI, it's mapped to Mistral
        const standardForUi = standardProviders.filter((p) => p !== MISTRAL_LEGACY_PROVIDER_SLUG)
        const allProviders = [...new Set([...standardForUi, ...customProviders])]
        return allProviders.map((key) => {
            const label = PROVIDER_LABELS[key] ?? capitalize(key)
            return {
                label,
                options: [{label, value: key, key}],
            }
        })
    }, [standardProviders, customProviders])

    const providerValue = useWatch("provider", form) || ""
    const normalizedProviderKind = useMemo(() => {
        if (!providerValue || typeof providerValue !== "string") {
            return ""
        }

        const trimmedValue = providerValue.trim()
        const lowerCaseValue = trimmedValue.toLowerCase()

        return PROVIDER_KINDS[trimmedValue] ?? PROVIDER_KINDS[lowerCaseValue] ?? lowerCaseValue
    }, [providerValue])

    const shouldFilter = validProviders.includes(normalizedProviderKind)
    const hasSelectedProvider = !!(providerValue && providerValue.toString().trim().length)

    useEffect(() => {
        if (selectedProvider) {
            const rawProvider = selectedProvider.provider ?? ""
            form.setFieldsValue({
                ...selectedProvider,
                // Map legacy `mistralai` to canonical `mistral` for form + select state
                provider: mistralLegacySlugToCanonical(
                    typeof rawProvider === "string" ? rawProvider : String(rawProvider),
                ),
            })
        } else {
            form.resetFields()
        }
    }, [selectedProvider, form])

    const onSubmit = async (values: LlmProvider) => {
        try {
            if (form.getFieldValue("models").length === 0 || !form.getFieldValue("models")[0]) {
                setErrorMessage("Please add a model name before submitting")
                return
            }

            if (selectedProvider?.id) {
                await handleModifyCustomVaultSecret({...values, id: selectedProvider?.id})
            } else {
                await handleModifyCustomVaultSecret(values)
            }

            onClose()
        } catch (error: any) {
            if (error.status === 422) {
                setErrorMessage(error.response.data.detail[0].msg)
            } else {
                setErrorMessage("Something went wrong! Please try again with the right credential.")
            }
        }
    }

    return (
        <Form
            form={form}
            layout="vertical"
            onFinish={onSubmit}
            initialValues={{
                provider: "",
                name: "",
                apiKey: "",
                apiBaseUrl: "",
                accessKeyId: "",
                accessKey: "",
                sessionToken: "",
                models: [""],
            }}
        >
            <section className="[&_>.ant-form-item]:!mb-0 flex flex-col gap-4">
                {hasSelectedProvider && errorMessage && (
                    <Typography.Text className="mb-1 flex items-center gap-1" type="danger">
                        <WarningCircle size={16} /> {errorMessage.replace("Value error,", "")}
                    </Typography.Text>
                )}

                <div className="flex flex-col gap-1">
                    <Text className="font-medium">
                        Provider<span aria-hidden> *</span>
                    </Text>
                    <Form.Item name="provider" className="mb-0" rules={[{required: true}]}>
                        <SelectLLMProviderBase options={providerOptions} />
                    </Form.Item>
                </div>

                {hasSelectedProvider && (
                    <>
                        {PROVIDER_FIELDS.filter((field) => {
                            if (shouldFilter) {
                                return !field.model || field.model.includes(normalizedProviderKind)
                            }
                            return true
                        }).map((rawField) => {
                            const field = rawField as FieldWithAttributes
                            const isJson = field.attributes?.kind === "json"
                            const isRequired =
                                field.key === "apiBaseUrl"
                                    ? false
                                    : !shouldFilter
                                      ? !!field.required
                                      : true

                            return (
                                <React.Fragment key={field.key}>
                                    <Form.Item
                                        name={field.key}
                                        rules={[
                                            {
                                                required: isRequired,
                                                ...(field.key === "name"
                                                    ? {
                                                          validator(_, value) {
                                                              if (!value)
                                                                  return Promise.reject(
                                                                      "Please enter name",
                                                                  )
                                                              if (!isAppNameInputValid(value)) {
                                                                  return Promise.reject(
                                                                      "Name must contain only letters, numbers, underscore, or dash without any spaces.",
                                                                  )
                                                              }
                                                              if (
                                                                  defaultProviderNames.has(
                                                                      value.trim().toLowerCase(),
                                                                  )
                                                              ) {
                                                                  return Promise.reject(
                                                                      "Name cannot match a default provider. Please choose a different name.",
                                                                  )
                                                              }
                                                              return Promise.resolve()
                                                          },
                                                      }
                                                    : {}),
                                            },
                                            ...(isJson
                                                ? [
                                                      {
                                                          validator(_, value) {
                                                              if (!value) return Promise.resolve()
                                                              try {
                                                                  JSON.parse(value)
                                                                  return Promise.resolve()
                                                              } catch {
                                                                  return Promise.reject(
                                                                      "Must be valid JSON",
                                                                  )
                                                              }
                                                          },
                                                      },
                                                  ]
                                                : []),
                                        ]}
                                    >
                                        {renderControl(field, isRequired)}
                                    </Form.Item>

                                    {field.note && (
                                        <Text className="text-[#586673] -mt-2">{field.note}</Text>
                                    )}
                                </React.Fragment>
                            )
                        })}

                        <Form.List name="models">
                            {(fields, {add, remove}) => (
                                <div className="flex flex-col gap-2">
                                    <div className="w-full flex items-center justify-between">
                                        <Text className="font-medium">Models</Text>
                                        <Button
                                            icon={<Plus size={14} />}
                                            size="small"
                                            onClick={() => add()}
                                        >
                                            Add
                                        </Button>
                                    </div>

                                    {fields.length === 0 ? (
                                        <Text className="text-[#586673]">
                                            No custom models configured
                                        </Text>
                                    ) : (
                                        fields.map((field) => {
                                            const {key, ...restField} = field
                                            return (
                                                <Form.Item
                                                    key={key}
                                                    {...restField}
                                                    rules={[
                                                        {
                                                            required: true,
                                                            message: "Please add a model name",
                                                            min: 1,
                                                        },
                                                    ]}
                                                    className="mb-0"
                                                >
                                                    <ModelNameInput
                                                        onDelete={() => remove(field.name)}
                                                    />
                                                </Form.Item>
                                            )
                                        })
                                    )}
                                </div>
                            )}
                        </Form.List>
                    </>
                )}
            </section>
        </Form>
    )
}

export default ConfigureProviderDrawerContent
