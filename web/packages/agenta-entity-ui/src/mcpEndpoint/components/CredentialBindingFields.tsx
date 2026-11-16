/**
 * Where an API key goes, on the key screen: Send as, Name, Prefix, and a line that shows
 * what is sent. "In the URL" has no Name or Prefix: the address says where the key goes, and
 * the key screen shows that address under these fields.
 *
 * A raw key under `Authorization` is refused by every server that names a scheme, and the
 * header field alone gave no way to say `Bearer` or `Basic`. The prefix is its own field so
 * the reader sees it, and the preview line is built by the same rule the relay sends by
 * (`credentialBindingPreview`), so it is what goes out.
 */
import {
    credentialBindingPreview,
    mcpChallengeScheme,
    type MCPCredentialBinding,
    type MCPServerProbe,
} from "@agenta/entities/mcpEndpoint"
import {createT, richText, useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"

import {HintedField} from "./HintedField"

type Kind = MCPCredentialBinding["kind"]
type PrefixChoice = "none" | "Bearer" | "Basic" | "custom"

const tNow = createT(mcpConnectCatalog)

/** Said under Prefix when the server named a scheme the prefix does not send. */
export const headerSchemeHint = (scheme: string): string =>
    tNow("entityUi.mcpConnect.headerSchemeHint", {scheme})

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
    const t = useT(mcpConnectCatalog)
    const kindLabel: Record<Kind, string> = {
        header: t("entityUi.mcpConnect.kindHeader"),
        query: t("entityUi.mcpConnect.kindQuery"),
        url: t("entityUi.mcpConnect.kindUrl"),
    }
    const prefixLabel: Record<PrefixChoice, string> = {
        none: t("entityUi.mcpConnect.prefixNone"),
        Bearer: "Bearer",
        Basic: "Basic",
        custom: t("entityUi.mcpConnect.prefixCustom"),
    }
    const prefixChoice = prefixChoiceOf(value.prefix)
    const scheme = mcpChallengeScheme(probe)
    const schemeDisagrees =
        !!scheme && scheme.toLowerCase() !== (value.prefix ?? "").trim().toLowerCase()
    const preview = credentialBindingPreview(value)

    const prefixHint = [
        prefixChoice === "Basic" ? t("entityUi.mcpConnect.basicPrefixHint") : null,
        prefixChoice === "none" && value.kind === "header"
            ? t("entityUi.mcpConnect.noPrefixHint")
            : null,
        schemeDisagrees ? headerSchemeHint(scheme) : null,
    ].filter(Boolean)

    return (
        <div className="flex flex-col gap-3" data-testid="mcp-credential-binding">
            <HintedField label={t("entityUi.mcpConnect.sendAs")}>
                <ChoiceSelect
                    label={t("entityUi.mcpConnect.sendAs")}
                    value={value.kind}
                    options={kindLabel}
                    disabled={disabled}
                    // Only a header takes a prefix (`normalizeCredentialBinding`).
                    onChange={(kind) =>
                        onChange({...value, kind, prefix: kind === "header" ? value.prefix : null})
                    }
                />
            </HintedField>
            {value.kind === "url" ? null : (
                <HintedField
                    label={t("entityUi.mcpConnect.name")}
                    tooltip={
                        value.kind === "header" && !invalid
                            ? t("entityUi.mcpConnect.headerHelp")
                            : undefined
                    }
                    invalid={invalid}
                >
                    <Input
                        className="font-mono text-[13px]"
                        placeholder={value.kind === "header" ? "Authorization" : "api_key"}
                        value={value.name ?? ""}
                        disabled={disabled}
                        aria-label={
                            value.kind === "header"
                                ? t("entityUi.mcpConnect.headerName")
                                : t("entityUi.mcpConnect.parameterName")
                        }
                        aria-describedby={describedBy}
                        onChange={(event) => onChange({...value, name: event.target.value})}
                    />
                </HintedField>
            )}
            {value.kind === "header" ? (
                <HintedField
                    label={t("entityUi.mcpConnect.prefix")}
                    hint={
                        prefixHint.length || preview ? (
                            <>
                                {prefixHint.join(" ")}
                                {prefixHint.length && preview ? " " : null}
                                {preview
                                    ? richText(t("entityUi.mcpConnect.sentAs", {preview}), {
                                          code: (text) => <span className="font-mono">{text}</span>,
                                      })
                                    : null}
                            </>
                        ) : null
                    }
                >
                    <ChoiceSelect
                        label={t("entityUi.mcpConnect.prefix")}
                        value={prefixChoice}
                        options={prefixLabel}
                        disabled={disabled}
                        onChange={(choice) => onChange({...value, prefix: prefixFor(choice)})}
                    />
                </HintedField>
            ) : preview ? (
                <p className="m-0 text-xs leading-normal text-colorTextTertiary">
                    {richText(t("entityUi.mcpConnect.sentAs", {preview}), {
                        code: (text) => <span className="font-mono">{text}</span>,
                    })}
                </p>
            ) : null}
            {value.kind === "header" && prefixChoice === "custom" ? (
                <Input
                    className="-mt-1 font-mono text-[13px]"
                    value={value.prefix ?? ""}
                    disabled={disabled}
                    aria-label={t("entityUi.mcpConnect.customPrefix")}
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
