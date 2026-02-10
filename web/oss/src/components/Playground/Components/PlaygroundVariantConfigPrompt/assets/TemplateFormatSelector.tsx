import {useMemo} from "react"

import {getMetadataLazy} from "@agenta/entities/legacyAppRevision"
import clsx from "clsx"
import {useAtom} from "jotai"

import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"
import {
    promptTemplateFormatAtomFamily,
    type PromptTemplateFormat,
} from "@/oss/components/Playground/state/atoms"
import type {
    BaseOption,
    OptionGroup,
    SelectOptions,
    StringMetadata,
} from "@/oss/lib/shared/variant/genericTransformer/types"

import SimpleDropdownSelect from "../../PlaygroundVariantPropertyControl/assets/SimpleDropdownSelect"

interface TemplateFormatSelectorProps {
    variantId: string
    disabled?: boolean
}

interface TemplateOption {
    value: PromptTemplateFormat
    label: string
}

const FALLBACK_OPTIONS: TemplateOption[] = [
    {value: "curly", label: "curly"},
    // {value: "fstring", label: "fstring"},
    {value: "jinja2", label: "jinja2"},
]

const DEFAULT_LABEL = "Prompt syntax"

const getTemplateFormatNode = (prompt: any): any => {
    if (!prompt || typeof prompt !== "object") return undefined
    return (
        prompt.templateFormat ??
        prompt.template_format ??
        prompt?.prompt?.templateFormat ??
        prompt?.prompt?.template_format
    )
}

const isOptionGroupArray = (options: SelectOptions): options is OptionGroup[] => {
    return (
        Array.isArray(options) &&
        options.length > 0 &&
        typeof options[0] === "object" &&
        options[0] !== null &&
        "options" in (options[0] as OptionGroup)
    )
}

const normalizeOptions = (options?: SelectOptions): TemplateOption[] => {
    if (!options) return []
    if (!Array.isArray(options)) return []

    if (isOptionGroupArray(options)) {
        return (
            options
                .flatMap(
                    (group) =>
                        (group.options || [])
                            .map((option) => {
                                const rawValue = option?.value ?? option?.label
                                if (!rawValue) return null
                                const value = String(rawValue) as PromptTemplateFormat
                                const label = option?.label ?? String(option.value ?? "")
                                return {value, label}
                            })
                            .filter(Boolean) as TemplateOption[],
                )
                // hard block fstring for grouped options too
                .filter((opt) => opt.value !== "fstring")
        )
    }

    return (
        (options as BaseOption[])
            // hard block fstring for flat options
            .filter((option) => option.value !== "fstring")
            .map((option) => {
                const rawValue = option?.value ?? option?.label
                if (!rawValue) return null
                const value = String(rawValue) as PromptTemplateFormat
                const label = option?.label ?? String(option.value ?? "")
                return {value, label}
            })
            .filter(Boolean) as TemplateOption[]
    )
}

const TemplateFormatSelector: React.FC<TemplateFormatSelectorProps> = ({
    variantId,
    disabled = false,
}) => {
    const templateAtom = useMemo(() => promptTemplateFormatAtomFamily(variantId), [variantId])
    const [format, setFormat] = useAtom(templateAtom)
    const prompts = usePromptsSource(variantId)

    const {options, label} = useMemo(() => {
        let metadata: StringMetadata | null = null

        for (const prompt of prompts || []) {
            const node = getTemplateFormatNode(prompt)
            if (node && typeof node === "object" && "__metadata" in node) {
                const candidate = getMetadataLazy<StringMetadata>(node.__metadata)
                if (candidate) {
                    metadata = candidate
                    if (candidate.options && candidate.options.length > 0) {
                        break
                    }
                }
            }
        }

        const normalized = normalizeOptions(metadata?.options)
        return {
            options: normalized.length > 0 ? normalized : FALLBACK_OPTIONS,
            label: DEFAULT_LABEL,
        }
    }, [prompts])

    const dropdownOptions = useMemo(
        () =>
            options.map((option) => ({
                key: option.value,
                value: option.value,
                label: option.label,
            })),
        [options],
    )

    const currentOption = useMemo(
        () => options.find((option) => option.value === format),
        [options, format],
    )

    const displayValue = useMemo(() => {
        const optionLabel = currentOption?.label || format
        return `${label}: ${optionLabel}`
    }, [currentOption?.label, format, label])

    return (
        <SimpleDropdownSelect
            value={displayValue}
            options={dropdownOptions}
            onChange={(nextValue) => setFormat(nextValue as PromptTemplateFormat)}
            placeholder={label}
            className={clsx(
                "mt-2 border border-[#bdc7d1] h-[24px]",
                "transition-all duration-200 ease-in-out",
                "hover:!bg-transparent hover:!border-[#394857]",
                disabled && "opacity-50 cursor-not-allowed",
            )}
            description={label}
            withTooltip={false}
            disabled={disabled}
        />
    )
}

export default TemplateFormatSelector
