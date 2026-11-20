/**
 * Display text for the provider credential fields that `@agenta/entities` declares.
 *
 * The field config keeps English only as data; the forms that render it (the custom-provider form
 * and the connection card) read the active language from here, by field key. Read on every
 * render, so the text follows the language and a catalog that loads after the form opens.
 */
import type {
    LlmEndpointProtocol,
    ProviderChoiceFieldConfig,
    ProviderFieldConfig,
} from "@agenta/entities/secret"
import {createT, type CatalogKey} from "@agenta/i18n"
import customProviderFormCatalog from "@agenta/i18n/catalogs/entityUi.customProviderForm"

const tNow = createT(customProviderFormCatalog)
type FormKey = CatalogKey<typeof customProviderFormCatalog>

/** Display text per field key. The field config in @agenta/entities keeps English only as data. */
const FIELD_TEXT: Record<string, {label: FormKey; placeholder: FormKey}> = {
    name: {
        label: "entityUi.customProviderForm.nameLabel",
        placeholder: "entityUi.customProviderForm.namePlaceholder",
    },
    apiKey: {
        label: "entityUi.customProviderForm.apiKeyLabel",
        placeholder: "entityUi.customProviderForm.apiKeyPlaceholder",
    },
    apiBaseUrl: {
        label: "entityUi.customProviderForm.apiBaseUrlLabel",
        placeholder: "entityUi.customProviderForm.apiBaseUrlPlaceholder",
    },
    version: {
        label: "entityUi.customProviderForm.versionLabel",
        placeholder: "entityUi.customProviderForm.versionPlaceholder",
    },
    region: {
        label: "entityUi.customProviderForm.regionLabel",
        placeholder: "entityUi.customProviderForm.regionPlaceholder",
    },
    vertexProject: {
        label: "entityUi.customProviderForm.vertexProjectLabel",
        placeholder: "entityUi.customProviderForm.vertexProjectPlaceholder",
    },
    vertexLocation: {
        label: "entityUi.customProviderForm.vertexLocationLabel",
        placeholder: "entityUi.customProviderForm.vertexLocationPlaceholder",
    },
    vertexCredentials: {
        label: "entityUi.customProviderForm.vertexCredentialsLabel",
        placeholder: "entityUi.customProviderForm.vertexCredentialsPlaceholder",
    },
    bearerToken: {
        label: "entityUi.customProviderForm.bearerTokenLabel",
        placeholder: "entityUi.customProviderForm.bearerTokenPlaceholder",
    },
    accessKeyId: {
        label: "entityUi.customProviderForm.accessKeyIdLabel",
        placeholder: "entityUi.customProviderForm.accessKeyIdPlaceholder",
    },
    accessKey: {
        label: "entityUi.customProviderForm.accessKeyLabel",
        placeholder: "entityUi.customProviderForm.accessKeyPlaceholder",
    },
    sessionToken: {
        label: "entityUi.customProviderForm.sessionTokenLabel",
        placeholder: "entityUi.customProviderForm.sessionTokenPlaceholder",
    },
}

/** A field's hint, by `<field>/<provider kind>` first, then by field. */
const NOTE_TEXT: Record<string, FormKey> = {
    "apiBaseUrl/custom": "entityUi.customProviderForm.apiBaseUrlNoteCustom",
    "apiBaseUrl/azure": "entityUi.customProviderForm.apiBaseUrlNoteAzure",
    bearerToken: "entityUi.customProviderForm.bearerTokenNote",
    apiKey: "entityUi.customProviderForm.secretNote",
    vertexCredentials: "entityUi.customProviderForm.secretNote",
    accessKeyId: "entityUi.customProviderForm.secretNote",
    accessKey: "entityUi.customProviderForm.secretNote",
    sessionToken: "entityUi.customProviderForm.secretNote",
}

/** Label overrides by `<field>/<provider kind>`, for the card's per-kind labels. */
const CARD_LABEL_TEXT: Record<string, FormKey> = {
    "apiKey/custom": "entityUi.customProviderForm.apiKeyLabelCustom",
}

/** The protocol options' labels, by protocol value. */
const PROTOCOL_OPTION_TEXT: Record<LlmEndpointProtocol, FormKey> = {
    openai: "entityUi.customProviderForm.protocolOpenai",
    anthropic: "entityUi.customProviderForm.protocolAnthropic",
}

const textFor = (map: Record<string, FormKey>, keys: string[]): FormKey | undefined => {
    const key = keys.find((candidate) => Object.hasOwn(map, candidate))
    return key ? map[key] : undefined
}

/**
 * A field in the active language. `note` is the field's resolved hint for `kind` (or none);
 * a field this module has no text for keeps its own. `perKindLabels` reads the card's per-kind
 * label overrides, which the custom-provider form does not use.
 */
export const translateProviderField = (
    field: ProviderFieldConfig,
    kind: string,
    {perKindLabels = false}: {perKindLabels?: boolean} = {},
): ProviderFieldConfig => {
    const text = Object.hasOwn(FIELD_TEXT, field.key) ? FIELD_TEXT[field.key] : undefined
    const kindLabel = perKindLabels ? textFor(CARD_LABEL_TEXT, [`${field.key}/${kind}`]) : undefined
    const noteKey = field.note ? textFor(NOTE_TEXT, [`${field.key}/${kind}`, field.key]) : undefined
    return {
        ...field,
        label: kindLabel ? tNow(kindLabel) : text ? tNow(text.label) : field.label,
        placeholder: text ? tNow(text.placeholder) : field.placeholder,
        note: noteKey ? tNow(noteKey) : field.note,
    }
}

/** The endpoint protocol control in the active language. */
export const translateProtocolField = (
    field: ProviderChoiceFieldConfig,
): ProviderChoiceFieldConfig => ({
    ...field,
    label: tNow("entityUi.customProviderForm.protocolLabel"),
    options: field.options.map((option) => {
        const key = textFor(PROTOCOL_OPTION_TEXT, [option.value])
        return key ? {...option, label: tNow(key)} : option
    }),
})

/** A provider's display name; the OpenAI-compatible endpoint is the one that is not a brand. */
export const providerDisplayTitle = (kind: string, title: string): string =>
    kind === "custom" ? tNow("entityUi.customProviderForm.openaiCompatibleEndpoint") : title
