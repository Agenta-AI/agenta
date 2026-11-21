/**
 * The commit diff's words (`CommitDiffText` in `@agenta/entities`), from the `entityUi.commitDiff`
 * catalog. Stored paths and values are looked up as own keys only: they are data.
 */
import type {CommitDiffText, CommitDiffWord} from "@agenta/entities/workflow/commitDiff"
import {createT, getActiveLanguage, type CatalogKey} from "@agenta/i18n"
import commitDiffCatalog from "@agenta/i18n/catalogs/entityUi.commitDiff"

import {permissionPolicyLabel} from "../DrillInView/SchemaControls/permissionPolicy"

const tNow = createT(commitDiffCatalog)
type Key = CatalogKey<typeof commitDiffCatalog>

const WORDS: Record<CommitDiffWord, Key> = {
    "section.model": "entityUi.commitDiff.sectionModel",
    "section.instructions": "entityUi.commitDiff.sectionInstructions",
    "section.tools": "entityUi.commitDiff.sectionTools",
    "section.integrations": "entityUi.commitDiff.sectionIntegrations",
    "section.subagents": "entityUi.commitDiff.sectionSubagents",
    "section.mcps": "entityUi.commitDiff.sectionMcps",
    "section.skills": "entityUi.commitDiff.sectionSkills",
    "section.params": "entityUi.commitDiff.sectionAdvanced",
    edited: "entityUi.commitDiff.edited",
    changed: "entityUi.commitDiff.changed",
    added: "entityUi.commitDiff.added",
    removed: "entityUi.commitDiff.removed",
    permissions: "entityUi.commitDiff.fieldPermissions",
    description: "entityUi.commitDiff.fieldDescription",
    name: "entityUi.commitDiff.fieldName",
    instructions: "entityUi.commitDiff.fieldInstructions",
    item: "entityUi.commitDiff.item",
    on: "entityUi.commitDiff.on",
    off: "entityUi.commitDiff.off",
    none: "entityUi.commitDiff.none",
}

const COUNTS = {
    added: "entityUi.commitDiff.addedCount",
    edited: "entityUi.commitDiff.editedCount",
    removed: "entityUi.commitDiff.removedCount",
    changed: "entityUi.commitDiff.changedCount",
} as const satisfies Record<string, Key>

/**
 * Setting names by exact config path: the same leaf means different things under different
 * parents. Wording follows the config panel's own controls.
 */
const PATH_LABELS: Record<string, Key> = {
    // Generation parameters (PARAM_KEYS).
    temperature: "entityUi.commitDiff.pathTemperature",
    max_tokens: "entityUi.commitDiff.pathMaxTokens",
    top_p: "entityUi.commitDiff.pathTopP",
    frequency_penalty: "entityUi.commitDiff.pathFrequencyPenalty",
    presence_penalty: "entityUi.commitDiff.pathPresencePenalty",
    tool_choice: "entityUi.commitDiff.pathToolChoice",
    response_format: "entityUi.commitDiff.pathResponseFormat",
    stream: "entityUi.commitDiff.pathStream",
    template_format: "entityUi.commitDiff.pathTemplateFormat",
    fallback_policy: "entityUi.commitDiff.pathFallbackPolicy",
    retry_policy: "entityUi.commitDiff.pathRetryPolicy",
    // Model & harness.
    "llm.model": "entityUi.commitDiff.pathModel",
    "llm.provider": "entityUi.commitDiff.pathProvider",
    "llm.connection.mode": "entityUi.commitDiff.pathConnectionMode",
    "harness.kind": "entityUi.commitDiff.pathHarness",
    "harness.max_iterations": "entityUi.commitDiff.pathMaxIterations",
    "harness.permissions.web_search": "entityUi.commitDiff.pathWebSearch",
    // Execution sections. The panel labels the runner policy "Policy" inside its Permissions
    // group; standalone in a diff row that says too little, so it names the subject too.
    "runner.permissions.default": "entityUi.commitDiff.pathToolPermissions",
    "harness.permissions.default_mode": "entityUi.commitDiff.pathPermissionMode",
    "harness.permissions.allow": "entityUi.commitDiff.pathAllowRules",
    "harness.permissions.ask": "entityUi.commitDiff.pathAskRules",
    "harness.permissions.deny": "entityUi.commitDiff.pathDenyRules",
    "sandbox.kind": "entityUi.commitDiff.pathSandbox",
    "sandbox.permissions": "entityUi.commitDiff.pathSandboxPermissions",
    "sandbox.permissions.network.mode": "entityUi.commitDiff.pathNetworkEgress",
    "sandbox.permissions.filesystem": "entityUi.commitDiff.pathFilesystem",
    "sandbox.permissions.enforcement": "entityUi.commitDiff.pathEnforcement",
}

/** Enum vocabularies lifted from the controls that author them, by path, then stored value. */
const VALUE_LABELS: Record<string, Record<string, Key>> = {
    "harness.permissions.default_mode": {
        default: "entityUi.commitDiff.modeDefault",
        acceptEdits: "entityUi.commitDiff.modeAcceptEdits",
        plan: "entityUi.commitDiff.modePlan",
        bypassPermissions: "entityUi.commitDiff.modeBypass",
    },
    "sandbox.permissions.network.mode": {
        on: "entityUi.commitDiff.networkOn",
        off: "entityUi.commitDiff.networkOff",
        allowlist: "entityUi.commitDiff.networkAllowlist",
    },
    "sandbox.permissions.filesystem": {
        on: "entityUi.commitDiff.filesystemOn",
        readonly: "entityUi.commitDiff.filesystemReadonly",
        off: "entityUi.commitDiff.filesystemOff",
    },
}

/** An integration's permission vocabulary, as the tool form spells it. */
const GATEWAY_PERMISSIONS: Record<string, Key> = {
    allow: "entityUi.commitDiff.gatewayAllow",
    ask: "entityUi.commitDiff.gatewayAsk",
    deny: "entityUi.commitDiff.gatewayDeny",
    inherit: "entityUi.commitDiff.gatewayInherit",
}

/** Languages that write a common noun in lower case inside a sentence. */
const LOWERCASE_IN_SENTENCE = new Set(["en", "es-ES", "pt-BR", "fr-FR"])

/** The commit diff's words in the active language, for display only. */
export const commitDiffTextNow = (): CommitDiffText => {
    const language = getActiveLanguage()
    return {
        word: (word) => tNow(WORDS[word]),
        count: (kind, count) => tNow(COUNTS[kind], {count}),
        typeAdded: (type) => tNow("entityUi.commitDiff.typeAdded", {type}),
        fieldsChanged: (fields) =>
            tNow("entityUi.commitDiff.fieldsChanged", {
                fields: fields.join(tNow("entityUi.commitDiff.fieldJoiner")),
            }),
        inSentence: (label) =>
            LOWERCASE_IN_SENTENCE.has(language) ? label.toLocaleLowerCase(language) : label,
        parameterCount: (count) => tNow("entityUi.commitDiff.parameterCount", {count}),
        permissionChange: (from, to) => tNow("entityUi.commitDiff.permissionChange", {from, to}),
        moreLines: (count) => tNow("entityUi.commitDiff.moreLines", {count}),
        pathLabel: (path) =>
            Object.hasOwn(PATH_LABELS, path) ? tNow(PATH_LABELS[path]) : undefined,
        valueLabel: (path, value) => {
            if (path === "runner.permissions.default") return permissionPolicyLabel(value)
            if (!Object.hasOwn(VALUE_LABELS, path)) return undefined
            const values = VALUE_LABELS[path]
            return Object.hasOwn(values, value) ? tNow(values[value]) : undefined
        },
        gatewayPermission: (value) =>
            tNow(
                value && Object.hasOwn(GATEWAY_PERMISSIONS, value)
                    ? GATEWAY_PERMISSIONS[value]
                    : "entityUi.commitDiff.gatewayInherit",
            ),
    }
}
