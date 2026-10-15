/**
 * Where an API key goes, on the key screen: Send as, Name, Prefix, and a line that shows
 * what is sent.
 *
 * A raw key under `Authorization` is refused by every server that names a scheme, and the
 * header field alone gave no way to say `Bearer` or `Basic`. The prefix is its own field so
 * the reader sees it, and the preview line is built by the same rule the relay sends by
 * (`credentialBindingPreview`), so it is what goes out.
 *
 * The presets only fill these fields. They are not a mode and nothing stores which one was
 * pressed.
 */
import {
    credentialBindingPreview,
    MCP_DEFAULT_CREDENTIAL_BINDING,
    mcpChallengeScheme,
    type MCPCredentialBinding,
    type MCPServerProbe,
} from "@agenta/entities/mcpEndpoint"
import {
    Button,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"

import {HintedField} from "./HintedField"

type Kind = MCPCredentialBinding["kind"]
type PrefixChoice = "none" | "Bearer" | "Basic" | "custom"

const CREDENTIAL_PRESETS: {label: string; binding: MCPCredentialBinding}[] = [
    {label: "Bearer token", binding: MCP_DEFAULT_CREDENTIAL_BINDING},
    {label: "Custom header", binding: {kind: "header", name: "", prefix: null}},
    {label: "Basic", binding: {kind: "header", name: "Authorization", prefix: "Basic"}},
    {label: "Query parameter", binding: {kind: "query", name: "", prefix: null}},
]

const KIND_LABEL: Record<Kind, string> = {header: "Header", query: "Query parameter"}

const PREFIX_LABEL: Record<PrefixChoice, string> = {
    none: "None",
    Bearer: "Bearer",
    Basic: "Basic",
    custom: "Custom",
}

const HEADER_HELP = "The HTTP header this server expects, for example x-api-key"

const BASIC_HINT =
    "What goes in front of the secret. Basic expects username:password encoded once; the helper below does that."
const NO_PREFIX_HINT = "The secret is sent as the header value with nothing in front of it."

/** Said under Prefix when the server named a scheme the prefix does not send. */
export const headerSchemeHint = (scheme: string): string =>
    `This server asked for the ${scheme} scheme.`

/**
 * The menu entry a prefix reads back as. An empty string is Custom with nothing typed yet,
 * which `normalizeCredentialBinding` sends as no prefix.
 */
const prefixChoiceOf = (prefix: string | null | undefined): PrefixChoice => {
    if (prefix == null) return "none"
    if (prefix === "Bearer" || prefix === "Basic") return prefix
    return "custom"
}

const prefixFor = (choice: PrefixChoice): string | null => {
    if (choice === "none") return null
    if (choice === "custom") return ""
    return choice
}

export interface CredentialBindingFieldsProps {
    value: MCPCredentialBinding
    onChange: (binding: MCPCredentialBinding) => void
    /** What the server answered, for the scheme it asked for. */
    probe: MCPServerProbe | null
    disabled?: boolean
    /** The server refused the key, which marks the fields that sent it. */
    invalid?: boolean
    /** The refusal box, which the refused fields point at. */
    "aria-describedby"?: string
}

export const CredentialBindingFields = ({
    value,
    onChange,
    probe,
    disabled,
    invalid,
    "aria-describedby": describedBy,
}: CredentialBindingFieldsProps) => {
    const prefixChoice = prefixChoiceOf(value.prefix)
    const scheme = mcpChallengeScheme(probe)
    const schemeDisagrees =
        !!scheme && scheme.toLowerCase() !== (value.prefix ?? "").trim().toLowerCase()
    const preview = credentialBindingPreview(value)

    const prefixHint = [
        prefixChoice === "Basic" ? BASIC_HINT : null,
        prefixChoice === "none" && value.kind === "header" ? NO_PREFIX_HINT : null,
        schemeDisagrees ? headerSchemeHint(scheme) : null,
    ].filter(Boolean)

    return (
        <div className="flex flex-col gap-3" data-testid="mcp-credential-binding">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-colorText">Preset</span>
                {CREDENTIAL_PRESETS.map((preset) => (
                    <Button
                        key={preset.label}
                        variant="outline"
                        size="xs"
                        disabled={disabled}
                        onClick={() => onChange(preset.binding)}
                    >
                        {preset.label}
                    </Button>
                ))}
            </div>
            <HintedField label="Send as">
                <ChoiceSelect
                    label="Send as"
                    value={value.kind}
                    options={KIND_LABEL}
                    disabled={disabled}
                    // A query value takes no prefix (`normalizeCredentialBinding`).
                    onChange={(kind) =>
                        onChange({...value, kind, prefix: kind === "query" ? null : value.prefix})
                    }
                />
            </HintedField>
            <HintedField
                label="Name"
                tooltip={value.kind === "header" && !invalid ? HEADER_HELP : undefined}
                invalid={invalid}
            >
                <Input
                    className="font-mono text-[13px]"
                    placeholder={value.kind === "header" ? "Authorization" : "api_key"}
                    value={value.name}
                    disabled={disabled}
                    aria-label={value.kind === "header" ? "Header name" : "Parameter name"}
                    aria-describedby={describedBy}
                    onChange={(event) => onChange({...value, name: event.target.value})}
                />
            </HintedField>
            {value.kind === "header" ? (
                <HintedField
                    label="Prefix"
                    hint={
                        prefixHint.length || preview ? (
                            <>
                                {prefixHint.join(" ")}
                                {prefixHint.length && preview ? " " : null}
                                {preview ? (
                                    <>
                                        Sent as <span className="font-mono">{preview}</span>.
                                    </>
                                ) : null}
                            </>
                        ) : null
                    }
                >
                    <ChoiceSelect
                        label="Prefix"
                        value={prefixChoice}
                        options={PREFIX_LABEL}
                        disabled={disabled}
                        onChange={(choice) => onChange({...value, prefix: prefixFor(choice)})}
                    />
                </HintedField>
            ) : preview ? (
                <p className="m-0 text-xs leading-normal text-colorTextTertiary">
                    Sent as <span className="font-mono">{preview}</span>.
                </p>
            ) : null}
            {value.kind === "header" && prefixChoice === "custom" ? (
                <Input
                    className="-mt-1 font-mono text-[13px]"
                    value={value.prefix ?? ""}
                    disabled={disabled}
                    aria-label="Custom prefix"
                    onChange={(event) => onChange({...value, prefix: event.target.value})}
                />
            ) : null}
        </div>
    )
}

/**
 * A select over a fixed set of labelled values.
 *
 * Takes `id` and `aria-describedby` and puts them on the trigger, because `Field` points its
 * label at the id it injects and the select root is not an element that can carry it.
 */
const ChoiceSelect = <T extends string>({
    label,
    value,
    options,
    disabled,
    onChange,
    id,
    "aria-describedby": describedBy,
}: {
    label: string
    value: T
    options: Record<T, string>
    disabled?: boolean
    onChange: (value: T) => void
    id?: string
    "aria-describedby"?: string
}) => (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger
            id={id}
            className="w-full"
            disabled={disabled}
            aria-label={label}
            aria-describedby={describedBy}
        >
            <SelectValue />
        </SelectTrigger>
        <SelectContent>
            {(Object.keys(options) as T[]).map((option) => (
                <SelectItem key={option} value={option}>
                    {options[option]}
                </SelectItem>
            ))}
        </SelectContent>
    </Select>
)

export default CredentialBindingFields
