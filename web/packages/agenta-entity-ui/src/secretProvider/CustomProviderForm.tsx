import React, {useCallback, useEffect, useMemo, useState} from "react"

import {
    PROVIDER_AUTH_REQUIREMENTS,
    PROVIDER_FIELDS,
    PROVIDER_KINDS,
    PROVIDER_LABELS,
    STANDARD_PROVIDER_KINDS,
    useVaultSecret,
    type ProviderFieldConfig,
} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {isSlugInputValid} from "@agenta/shared/utils"
import {LabelInput} from "@agenta/ui"
import {SelectLLMProviderBase, capitalize, type ProviderGroup} from "@agenta/ui/select-llm-provider"
import {Button, Textarea} from "@agenta/ui/ui"
import {Plus, WarningCircle} from "@phosphor-icons/react"

import ModelNameInput from "./ModelNameInput"

/** Imperative surface the host's footer (Submit button) drives — replaces the antd
 * `FormInstance` the pre-migration API shared with the caller. */
export interface CustomProviderFormHandle {
    submit: () => void
    reset: () => void
}

export interface CustomProviderFormProps {
    selectedProvider?: LlmProvider | null
    /** Pre-selects the provider kind for a NEW provider (editing ignores it — `selectedProvider`
     * already carries its own kind). */
    initialProviderKind?: string
    /** The host assigns `.current` here; its footer button calls `formRef.current?.submit()`. */
    formRef?: React.MutableRefObject<CustomProviderFormHandle | null>
    onClose: () => void
}

type FormValues = Partial<LlmProvider> & {provider?: string; models?: string[]}

const INITIAL_VALUES: FormValues = {
    provider: "",
    name: "",
    apiKey: "",
    apiBaseUrl: "",
    accessKeyId: "",
    accessKey: "",
    sessionToken: "",
    models: [""],
}

/** Error line under a control — replaces antd `Form.Item`'s validation message. */
const FieldError = ({error}: {error?: string}) =>
    error ? <span className="text-xs text-colorError">{error}</span> : null

/** Render control based on field.attributes */
const renderControl = (
    field: ProviderFieldConfig,
    isRequired: boolean | undefined,
    value: string,
    onChange: (next: string) => void,
    error?: string,
) => {
    const a = field.attributes

    if (!a || a.kind === "text") {
        // Keep your existing single-line input
        return (
            <LabelInput
                label={`${field.label}${isRequired ? " *" : ""}`}
                placeholder={field.placeholder}
                type={a?.type ?? a?.inputType ?? "text"}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        )
    }

    const isJson = a.kind === "json"
    return (
        <div className="flex flex-col gap-1">
            <span className="font-medium text-colorText">
                {field.label}
                {isRequired ? <span aria-hidden> *</span> : null}
            </span>
            <Textarea
                placeholder={
                    isJson
                        ? (field.placeholder ?? '{\n  "type": "service_account",\n  ...\n}')
                        : field.placeholder
                }
                rows={a.rows ?? (isJson ? 10 : 6)}
                className={(isJson ? a.monospace !== false : a.monospace) ? "font-mono" : undefined}
                spellCheck={false}
                autoComplete="off"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-invalid={error ? true : undefined}
            />
        </div>
    )
}

/**
 * Custom-provider add/edit form: provider select, credential fields (driven by
 * `PROVIDER_FIELDS`/`PROVIDER_AUTH_REQUIREMENTS`), and a repeatable model-name list.
 * Renders inline in any host (drawer, panel) — the caller owns the chrome (title, footer,
 * submit trigger) and drives submit/reset via `formRef` (`CustomProviderFormHandle`).
 */
const CustomProviderForm = ({
    formRef,
    onClose,
    selectedProvider,
    initialProviderKind,
}: CustomProviderFormProps) => {
    const [errorMessage, setErrorMessage] = useState("")
    const [values, setValues] = useState<FormValues>(INITIAL_VALUES)
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
    const {handleModifyCustomVaultSecret} = useVaultSecret()

    const setField = useCallback((key: string, next: unknown) => {
        setValues((prev) => ({...prev, [key]: next}))
        setFieldErrors((prev) => {
            if (!(key in prev)) return prev
            const {[key]: _removed, ...rest} = prev
            return rest
        })
    }, [])

    const standardProviders = useMemo(() => [...STANDARD_PROVIDER_KINDS], [])
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
        const allProviders = [...new Set([...standardProviders, ...customProviders])]
        return allProviders.map((key) => {
            const label = PROVIDER_LABELS[key] ?? capitalize(key)
            return {
                label,
                options: [{label, value: key, key}],
            }
        })
    }, [standardProviders, customProviders])

    const providerValue = values.provider || ""
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

    // Fields that belong to this provider's either/or auth sets — validated as a group, not each
    // individually required. Derived from PROVIDER_AUTH_REQUIREMENTS so nothing is hardcoded here.
    const eitherOrAuthKeys = useMemo(
        () =>
            new Set<string>(
                (PROVIDER_AUTH_REQUIREMENTS[normalizedProviderKind]?.alternatives ?? []).flat(),
            ),
        [normalizedProviderKind],
    )

    const reset = useCallback(() => {
        setValues(
            initialProviderKind
                ? {...INITIAL_VALUES, provider: initialProviderKind}
                : INITIAL_VALUES,
        )
        setFieldErrors({})
        setErrorMessage("")
    }, [initialProviderKind])

    useEffect(() => {
        if (selectedProvider) {
            const rawProvider = String(selectedProvider.provider ?? "")
            setValues({
                ...INITIAL_VALUES,
                ...selectedProvider,
                provider: PROVIDER_KINDS[rawProvider] ?? rawProvider,
            })
            setFieldErrors({})
        } else {
            reset()
        }
    }, [selectedProvider, initialProviderKind])

    const visibleFields = useMemo(
        () =>
            PROVIDER_FIELDS.filter((field) => {
                if (shouldFilter) {
                    return !field.model || field.model.includes(normalizedProviderKind)
                }
                return true
            }),
        [shouldFilter, normalizedProviderKind],
    )

    const isFieldRequired = useCallback(
        (field: ProviderFieldConfig) => {
            const isEitherOrAuthField = eitherOrAuthKeys.has(field.key)
            return field.key === "apiBaseUrl" || isEitherOrAuthField
                ? false
                : !shouldFilter
                  ? !!field.required
                  : true
        },
        [eitherOrAuthKeys, shouldFilter],
    )

    /** Per-field checks the antd `Form.Item` rules used to run — errors render under the field. */
    const validate = useCallback((): Record<string, string> => {
        const errors: Record<string, string> = {}
        if (!providerValue.trim()) {
            errors.provider = "Please select a provider"
        }

        for (const field of visibleFields) {
            const raw = String((values as Record<string, unknown>)[field.key] ?? "")
            const isJson = field.attributes?.kind === "json"

            if (field.key === "name") {
                if (!raw) {
                    errors.name = "Please enter name"
                } else if (!isSlugInputValid(raw)) {
                    errors.name =
                        "Name must contain only letters, numbers, underscore, or dash without any spaces."
                } else if (defaultProviderNames.has(raw.trim().toLowerCase())) {
                    errors.name =
                        "Name cannot match a default provider. Please choose a different name."
                }
                continue
            }

            if (isFieldRequired(field) && !raw.trim()) {
                errors[field.key] = `Please enter ${field.label}`
                continue
            }

            if (isJson && raw) {
                try {
                    JSON.parse(raw)
                } catch {
                    errors[field.key] = "Must be valid JSON"
                }
            }
        }

        ;(values.models ?? []).forEach((model, index) => {
            if (!model?.trim()) errors[`models.${index}`] = "Please add a model name"
        })

        return errors
    }, [providerValue, visibleFields, values, defaultProviderNames, isFieldRequired])

    const onSubmit = useCallback(async () => {
        if (!hasSelectedProvider) {
            setFieldErrors({provider: "Please select a provider"})
            return
        }
        const errors = validate()
        if (Object.keys(errors).length) {
            setFieldErrors(errors)
            return
        }
        setFieldErrors({})

        try {
            const models = values.models
            if (!models?.length || !models[0]) {
                setErrorMessage("Please add a model name before submitting")
                return
            }

            const authReq = PROVIDER_AUTH_REQUIREMENTS[normalizedProviderKind]
            if (authReq) {
                const filled = (key: keyof LlmProvider) =>
                    !!(values[key] as string | undefined)?.trim()
                const satisfied = authReq.alternatives.some((set) => set.every(filled))
                if (!satisfied) {
                    setErrorMessage(authReq.message)
                    return
                }
            }

            if (selectedProvider?.id) {
                await handleModifyCustomVaultSecret({
                    ...(values as LlmProvider),
                    id: selectedProvider?.id,
                })
            } else {
                await handleModifyCustomVaultSecret(values as LlmProvider)
            }

            onClose()
        } catch (error: unknown) {
            const apiError = error as {
                status?: number
                response?: {data?: {detail?: {msg?: string}[]}}
            }
            if (apiError.status === 422) {
                setErrorMessage(apiError.response?.data?.detail?.[0]?.msg ?? "Validation error")
            } else {
                setErrorMessage("Something went wrong! Please try again with the right credential.")
            }
        }
    }, [
        hasSelectedProvider,
        validate,
        values,
        normalizedProviderKind,
        selectedProvider,
        handleModifyCustomVaultSecret,
        onClose,
    ])

    useEffect(() => {
        if (!formRef) return
        formRef.current = {submit: () => void onSubmit(), reset}
        return () => {
            formRef.current = null
        }
    }, [formRef, onSubmit, reset])

    const models = values.models ?? []
    const addModel = () => setField("models", [...models, ""])
    const removeModel = (index: number) =>
        setField(
            "models",
            models.filter((_, i) => i !== index),
        )
    const updateModel = (index: number, next: string) => {
        setField(
            "models",
            models.map((model, i) => (i === index ? next : model)),
        )
        setFieldErrors((prev) => {
            const key = `models.${index}`
            if (!(key in prev)) return prev
            const {[key]: _removed, ...rest} = prev
            return rest
        })
    }

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault()
                void onSubmit()
            }}
        >
            <section className="flex flex-col gap-4">
                {hasSelectedProvider && errorMessage && (
                    <span className="mb-1 flex items-center gap-1 text-colorError">
                        <WarningCircle size={16} /> {errorMessage.replace("Value error,", "")}
                    </span>
                )}

                <div className="flex flex-col gap-1">
                    <span className="font-medium text-colorText">
                        Provider<span aria-hidden> *</span>
                    </span>
                    <SelectLLMProviderBase
                        options={providerOptions}
                        value={providerValue}
                        onChange={(next) => setField("provider", next)}
                        invalid={!!fieldErrors.provider}
                    />
                    <FieldError error={fieldErrors.provider} />
                </div>

                {hasSelectedProvider && (
                    <>
                        {visibleFields.map((field) => {
                            const isRequired = isFieldRequired(field)
                            const fieldValue = String(
                                (values as Record<string, unknown>)[field.key] ?? "",
                            )

                            return (
                                <React.Fragment key={field.key}>
                                    <div className="flex flex-col gap-1">
                                        {renderControl(
                                            field,
                                            isRequired,
                                            fieldValue,
                                            (next) => setField(field.key, next),
                                            fieldErrors[field.key],
                                        )}
                                        <FieldError error={fieldErrors[field.key]} />
                                    </div>

                                    {field.note && (
                                        <span className="text-[var(--ag-c-586673)] -mt-2">
                                            {field.note}
                                        </span>
                                    )}
                                </React.Fragment>
                            )
                        })}

                        <div className="flex flex-col gap-2">
                            <div className="w-full flex items-center justify-between">
                                <span className="font-medium text-colorText">Models</span>
                                <Button variant="outline" size="sm" onClick={() => addModel()}>
                                    <Plus size={14} />
                                    Add
                                </Button>
                            </div>

                            {models.length === 0 ? (
                                <span className="text-[var(--ag-c-586673)]">
                                    No custom models configured
                                </span>
                            ) : (
                                models.map((model, index) => (
                                    <div key={index} className="flex flex-col gap-1">
                                        <ModelNameInput
                                            value={model}
                                            onChange={(event) =>
                                                updateModel(index, event.target.value)
                                            }
                                            onDelete={() => removeModel(index)}
                                        />
                                        <FieldError error={fieldErrors[`models.${index}`]} />
                                    </div>
                                ))
                            )}
                        </div>
                    </>
                )}
            </section>
        </form>
    )
}

export default CustomProviderForm
