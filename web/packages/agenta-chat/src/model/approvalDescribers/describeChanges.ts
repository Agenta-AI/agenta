/**
 * The changes of a versioned agent change (`edit_agent_config`, `create_agent`) as card data.
 *
 * Old values come only from the server preview (the change-set engine's dry run on the call's
 * base revision). The browser never applies operations itself. Without a usable preview the card
 * shows the proposed values from the operations, and says so (`proposedValues`).
 */
import {
    NO_COMMIT_DIFF_TEXT,
    parseGatewayToolName,
    scalarKeyLabel,
} from "@agenta/entities/workflow/commitDiff"
import {createT} from "@agenta/i18n"
import chatChangeCardCatalog from "@agenta/i18n/catalogs/chat.changeCard"
import {asRecord} from "@agenta/shared/utils"

import type {
    ApprovalChange,
    ApprovalChangeDetail,
    ApprovalChangeFile,
    ApprovalChangeRiskLine,
    ApprovalChangeSection,
    ChangePreview,
    ChangePreviewChange,
} from "../../skin/types"

import {oneLine} from "./approvalText"

const t = createT(chatChangeCardCatalog)

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/** The preview when it has the contract's shape; anything else counts as no preview. */
export const parseChangePreview = (value: unknown): ChangePreview | null => {
    const preview = asRecord(value)
    if (!preview || typeof preview.applies !== "boolean") return null
    if (!Array.isArray(preview.operations) || !Array.isArray(preview.changes)) return null
    // Entries that are not objects are dropped, so a malformed entry cannot take the card down.
    return {
        ...preview,
        operations: preview.operations.filter(isRecord),
        changes: preview.changes.filter(isRecord),
    } as unknown as ChangePreview
}

/** Addressing scaffolding at the start of a target; nothing to read. */
const SCAFFOLDING = new Set(["parameters", "agent"])

const withoutScaffolding = (target: unknown[]): unknown[] => {
    let start = 0
    while (start < target.length && SCAFFOLDING.has(target[start] as string)) start++
    return target.slice(start)
}

/** `{list, key}` (or the older `{field, name}`) of a selector segment. */
const selector = (segment: unknown): {list?: string; key?: string} | null => {
    if (!isRecord(segment)) return null
    const list = segment.list ?? segment.field
    const key = segment.key ?? segment.name
    return {
        ...(typeof list === "string" ? {list} : {}),
        ...(typeof key === "string" ? {key} : {}),
    }
}

/** Where a target lands, in the words the card shows. */
interface Location {
    section: ApprovalChangeSection
    /** Display segments for the card header. */
    path: string[]
    /** The field a value row names. */
    label?: string
    /** The target is one whole list item (`{list, key}` last), or the list for `add_item`. */
    wholeItem: boolean
    /** The key of the list item the target is inside. */
    itemKey?: string
    /** A text the card shows as a diff: instructions, a skill body or a skill file. */
    text: boolean
    /** Inside a file of a skill. */
    file: boolean
    /** A permission field: its values read as Allow, Always ask, Deny. */
    permission: boolean
    /** The tool a permission field is for, when it names one. */
    tool?: string
    /** The stored name of the field the target ends on (`url`). */
    leaf?: string
}

const SECTION_LABEL: Record<ApprovalChangeSection, Parameters<typeof t>[0]> = {
    instructions: "chat.changeCard.sectionInstructions",
    model: "chat.changeCard.sectionModel",
    skills: "chat.changeCard.sectionSkills",
    mcps: "chat.changeCard.sectionMcps",
    integrations: "chat.changeCard.sectionIntegrations",
    tools: "chat.changeCard.sectionTools",
    permissions: "chat.changeCard.sectionPermissions",
    settings: "chat.changeCard.sectionSettings",
}

/** `gmail` / `my_app` → `Gmail` / `My app`. */
const titleCase = (token: string): string => {
    const cleaned = token.replace(/[_-]+/g, " ").trim()
    return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : token
}

/** A setting's name from its storage path (`harness.max_iterations` → "Harness › max iterations"). */
const settingLabel = (segments: string[]): string | undefined =>
    segments.length ? scalarKeyLabel(segments.join("."), NO_COMMIT_DIFF_TEXT) : undefined

const MODEL_FIELDS: Record<string, Parameters<typeof t>[0]> = {
    model: "chat.changeCard.fieldModel",
    reasoning: "chat.changeCard.fieldReasoning",
    reasoning_effort: "chat.changeCard.fieldReasoning",
    effort: "chat.changeCard.fieldReasoning",
}

/** The integration a `tools` entry is: its key `gateway_connection:{provider}:{integration}`. */
const integrationOf = (key: string | undefined, value: unknown): string | undefined => {
    if (key?.startsWith("gateway_connection:")) return key.split(":")[2] || undefined
    const entry = asRecord(value)
    return entry?.type === "gateway_connection" && typeof entry.integration === "string"
        ? entry.integration
        : undefined
}

const locateSkill = (rest: unknown[], key: string | undefined): Location => {
    const path = [t(SECTION_LABEL.skills), ...(key ? [key] : [])]
    let file = false
    let text = false
    let label: string | undefined
    // The key of a skill file the target selects; when it is the last segment, the target is
    // that whole file.
    let fileKey: string | undefined
    for (const segment of rest) {
        const picked = selector(segment)
        if (picked) {
            if (picked.list === "files" && picked.key) {
                path.push(picked.key)
                fileKey = picked.key
                file = true
                text = true
            }
            continue
        }
        if (segment === "body") {
            path.push("SKILL.md")
            text = true
        } else if (segment === "files") {
            file = true
        } else if (typeof segment === "string" && !(file && segment === "content")) {
            label = settingLabel([segment])
            text = false
        }
    }
    return {
        section: "skills",
        path,
        label,
        wholeItem:
            (Boolean(key) && rest.length === 0) ||
            (fileKey !== undefined && selector(rest[rest.length - 1])?.key === fileKey),
        itemKey: fileKey ?? key,
        text,
        file,
        permission: false,
    }
}

/** A permission field inside a `tools` or `mcps` entry, and the tool it names. */
const permissionField = (
    rest: string[],
    integration: string | undefined,
): {label: string; tool?: string} | null => {
    const at = rest.findIndex((segment) =>
        ["permissions", "permission", "tool_permissions", "new_tool_permission"].includes(segment),
    )
    if (at === -1) return null
    const field = rest[at]
    const after = rest.slice(at + 1)
    if (field === "new_tool_permission") return {label: t("chat.changeCard.fieldNewTools")}
    // `permissions.tools.{tool}` (an integration) or `tool_permissions.{tool}` (an MCP server).
    const toolName = field === "tool_permissions" ? after[0] : after[0] === "tools" && after[1]
    if (toolName) {
        // An action key repeats its integration (`ZENDESK_CLOSE_TICKET`); the path names the app.
        const prefix = integration ? `${integration.toUpperCase()}_` : ""
        const action =
            prefix && toolName.toUpperCase().startsWith(prefix)
                ? toolName.slice(prefix.length)
                : toolName
        const tool = parseGatewayToolName(
            `tools__gateway__${integration ?? "mcp"}__${action}`,
        ).label
        return {label: tool, tool}
    }
    return {label: t("chat.changeCard.fieldAllTools")}
}

/** Where a target lands. `value` is the operation's value, read only to name a new list item. */
export const locateTarget = (target: unknown[], value?: unknown): Location => {
    const segments = withoutScaffolding(target)
    const [head, ...rest] = segments
    const picked = selector(head)
    const list = picked?.list ?? (typeof head === "string" ? head : undefined)
    const key = picked?.key
    const strings = rest.filter((segment): segment is string => typeof segment === "string")
    const base = {wholeItem: false, text: false, file: false, permission: false}

    switch (list) {
        case "instructions":
            return {
                ...base,
                section: "instructions",
                path: [
                    t(SECTION_LABEL.instructions),
                    ...strings.map((segment) =>
                        segment === "agents_md" ? "AGENTS.md" : titleCase(segment),
                    ),
                ],
                text: true,
            }
        case "llm":
        case "llms":
        case "model": {
            const field = strings[strings.length - 1]
            return {
                ...base,
                section: "model",
                path: [t(SECTION_LABEL.model)],
                label: field
                    ? Object.hasOwn(MODEL_FIELDS, field)
                        ? t(MODEL_FIELDS[field])
                        : settingLabel([field])
                    : undefined,
            }
        }
        case "skills":
            return locateSkill(rest, key)
        case "mcps": {
            const name =
                key ?? (isRecord(value) && typeof value.name === "string" ? value.name : undefined)
            const permission = permissionField(strings, undefined)
            return {
                ...base,
                section: "mcps",
                path: [t(SECTION_LABEL.mcps), ...(key ? [key] : [])],
                label: permission?.label ?? settingLabel(strings),
                // A bare list (no selector) is the whole list, shown as its values.
                wholeItem: Boolean(key) && rest.length === 0,
                itemKey: name,
                leaf: strings[strings.length - 1],
                permission: Boolean(permission),
                tool: permission?.tool,
            }
        }
        case "tools": {
            const integration = integrationOf(key, value)
            const permission = permissionField(strings, integration)
            const section: ApprovalChangeSection = integration ? "integrations" : "tools"
            const name = integration
                ? (parseGatewayToolName(`tools__gateway__${integration}__x`).source ??
                  titleCase(integration))
                : key
            return {
                ...base,
                section,
                path: [t(SECTION_LABEL[section]), ...(key && name ? [name] : [])],
                label: permission?.label ?? settingLabel(strings),
                // A bare list (no selector) is the whole list, shown as its values.
                wholeItem: Boolean(key) && rest.length === 0,
                itemKey: name,
                permission: Boolean(permission),
                tool: permission?.tool,
            }
        }
        default: {
            const all = segments.filter((segment): segment is string => typeof segment === "string")
            const permission = all.includes("permissions")
            const section: ApprovalChangeSection = permission ? "permissions" : "settings"
            return {
                ...base,
                section,
                path: [t(SECTION_LABEL[section])],
                label: settingLabel(all),
                permission,
            }
        }
    }
}

type ChangeKind = "added" | "removed" | "changed"

const TITLES: Record<
    ApprovalChangeSection,
    Partial<Record<ChangeKind, Parameters<typeof t>[0]>>
> = {
    instructions: {changed: "chat.changeCard.titleEditInstructions"},
    model: {changed: "chat.changeCard.titleChangeModel"},
    skills: {
        added: "chat.changeCard.titleAddSkill",
        removed: "chat.changeCard.titleRemoveSkill",
        changed: "chat.changeCard.titleEditSkill",
    },
    mcps: {
        added: "chat.changeCard.titleAddMcp",
        removed: "chat.changeCard.titleRemoveMcp",
        changed: "chat.changeCard.titleChangeMcp",
    },
    integrations: {
        added: "chat.changeCard.titleAddIntegration",
        removed: "chat.changeCard.titleRemoveIntegration",
        changed: "chat.changeCard.titleChangeIntegration",
    },
    tools: {
        added: "chat.changeCard.titleAddTool",
        removed: "chat.changeCard.titleRemoveTool",
        changed: "chat.changeCard.titleChangeTool",
    },
    permissions: {changed: "chat.changeCard.titleChangePermissions"},
    settings: {changed: "chat.changeCard.titleChangeSetting"},
}

/** A whole item is named by its row, so the header path stops at the section. */
const headerPath = (location: Location, kind: ChangeKind): string[] =>
    location.wholeItem && kind !== "changed" && !location.file
        ? location.path.slice(0, 1)
        : location.path

/** A change with no detail, or a text, names its field at the end of its path; a value row names
 * it in its label. */
const withField = (
    path: string[],
    location: Location,
    detail: ApprovalChangeDetail | undefined,
): string[] =>
    (!detail || detail.kind === "text_diff") &&
    location.label &&
    path[path.length - 1] !== location.label
        ? [...path, location.label]
        : path

const changeTitle = (location: Location, kind: ChangeKind): string => {
    // A whole item comes and goes; a field inside one only changes.
    const itemKind: ChangeKind = location.wholeItem ? kind : "changed"
    if (location.permission && location.section !== "permissions")
        return t("chat.changeCard.titleChangePermission")
    if (location.file)
        return t(
            itemKind === "added"
                ? "chat.changeCard.titleAddSkillFile"
                : itemKind === "removed"
                  ? "chat.changeCard.titleRemoveSkillFile"
                  : "chat.changeCard.titleEditSkillFile",
        )
    const key = TITLES[location.section][itemKind] ?? TITLES[location.section].changed
    return key ? t(key) : t("chat.changeCard.titleChangeSetting")
}

const PERMISSION_VALUES: Record<string, Parameters<typeof t>[0]> = {
    allow: "chat.changeCard.permissionAllow",
    ask: "chat.changeCard.permissionAsk",
    deny: "chat.changeCard.permissionDeny",
    inherit: "chat.changeCard.permissionInherit",
}

/** A value as text to show: a permission in the form's words, strings as they are, else JSON. */
const displayValue = (value: unknown, location?: Location): string | undefined => {
    if (value === undefined) return undefined
    if (
        location?.permission &&
        typeof value === "string" &&
        Object.hasOwn(PERMISSION_VALUES, value)
    )
        return t(PERMISSION_VALUES[value])
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

/** A text that reads as a document (instructions, a skill body), not as a short value. */
const isLongText = (value: unknown): value is string =>
    typeof value === "string" && (value.includes("\n") || value.length > 120)

/** An MCP server's URL without the scheme, as the card shows it (`mcp.linear.app/sse`). */
const mcpAddress = (value: unknown): string | undefined => {
    const url = asRecord(asRecord(value)?.connection)?.url
    return typeof url === "string" && url ? url.replace(/^[a-z]+:\/\//i, "") : undefined
}

/** The files of a skill value: SKILL.md first when it has a body, then its bundled files. */
const skillFiles = (value: unknown): ApprovalChangeFile[] | undefined => {
    const skill = asRecord(value)
    if (!skill) return undefined
    const files: ApprovalChangeFile[] = typeof skill.body === "string" ? [{path: "SKILL.md"}] : []
    for (const file of Array.isArray(skill.files) ? skill.files : []) {
        const entry = asRecord(file)
        if (typeof entry?.path !== "string") continue
        files.push({path: entry.path, ...(entry.executable === true ? {executable: true} : {})})
    }
    return files.length ? files : undefined
}

const itemDetail = (
    change: "added" | "removed",
    location: Location,
    value: unknown,
): ApprovalChangeDetail => {
    const entry = asRecord(value)
    const name =
        (typeof entry?.name === "string" && entry.name) ||
        (location.file && typeof entry?.path === "string" && entry.path) ||
        location.itemKey ||
        location.path[location.path.length - 1] ||
        ""
    if (change === "removed") return {kind: "item", change, name}
    const description =
        typeof entry?.description === "string" && entry.description.trim()
            ? oneLine(entry.description)
            : undefined
    const address = location.section === "mcps" ? mcpAddress(value) : undefined
    const files = location.section === "skills" ? skillFiles(value) : undefined
    return {
        kind: "item",
        change,
        name,
        ...(description ? {description} : {}),
        ...(address ? {address} : {}),
        ...(files ? {files} : {}),
    }
}

/**
 * The risk a change adds (task 25.2). Only what the operation shows: a permission set to "Allow"
 * means fewer questions, and a new MCP server sends data to an outside server. The cost and
 * "stops working" lines need data the server preview does not carry yet.
 */
const risksOf = (
    location: Location,
    kind: ChangeKind,
    oldValue: unknown,
    newValue: unknown,
): ApprovalChangeRiskLine[] => {
    const risks: ApprovalChangeRiskLine[] = []
    const allows = (value: unknown) => value === "allow" || value === "bypassPermissions"
    if (location.permission && allows(newValue) && !allows(oldValue)) {
        risks.push({
            kind: "fewer_approvals",
            message: location.tool
                ? t("chat.changeCard.riskFewerApprovalsTool", {tool: location.tool})
                : t("chat.changeCard.riskFewerApprovals"),
        })
    }
    // A built-in route is Agenta's own server.
    const outside = (server: unknown) =>
        asRecord(asRecord(server)?.connection)?.namespace !== "builtin"
    const newServer =
        location.section === "mcps" && location.wholeItem && kind === "added" && outside(newValue)
    // The whole list set at once (a list that did not exist): a server it adds is new.
    const serverName = (server: unknown) => asRecord(server)?.name
    const known = new Set(Array.isArray(oldValue) ? oldValue.map(serverName) : [])
    const newInList =
        location.section === "mcps" &&
        // The bare `mcps` list itself, not a list inside one server.
        location.itemKey === undefined &&
        location.leaf === undefined &&
        Array.isArray(newValue) &&
        newValue.some(
            (server) => isRecord(server) && outside(server) && !known.has(serverName(server)),
        )
    const newUrl =
        location.section === "mcps" &&
        location.leaf === "url" &&
        typeof newValue === "string" &&
        /^[a-z]+:\/\//i.test(newValue) &&
        newValue !== oldValue
    if (newServer || newInList || newUrl)
        risks.push({kind: "data_egress", message: t("chat.changeCard.riskDataEgress")})
    return risks
}

/**
 * A changed object (`merge` on `llm`) reads as one row per field that differs, so the model and
 * the reasoning each get their own row. It compares the preview's own old and new values; it
 * applies no operation.
 */
const splitObjectChange = (change: ChangePreviewChange): ChangePreviewChange[] => {
    if (change.kind !== "changed" || !isRecord(change.old) || !isRecord(change.new)) return [change]
    const before = change.old
    const after = change.new
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    )
    if (!keys.length) return [change]
    const path = Array.isArray(change.path) ? change.path : []
    return keys.map((key) => ({
        path: [...path, key],
        operation_indexes: change.operation_indexes,
        kind: key in before ? (key in after ? "changed" : "removed") : "added",
        ...(key in before ? {old: before[key]} : {}),
        ...(key in after ? {new: after[key]} : {}),
    }))
}

/** The keyed lists of the engine (`KEY_FIELDS` in `change_set.py`) and the field of each key. */
const LIST_KEY_FIELD: Record<string, string> = {skills: "name", mcps: "name", files: "path"}

/** The entries of a list by key, or null when an entry has no key or a key repeats. */
const keyedEntries = (field: string, value: unknown): Map<string, unknown> | null => {
    if (value === undefined) return new Map()
    if (!Array.isArray(value)) return null
    const entries = new Map<string, unknown>()
    for (const entry of value) {
        const key = asRecord(entry)?.[field]
        if (typeof key !== "string" || !key || entries.has(key)) return null
        entries.set(key, entry)
    }
    return entries
}

/**
 * A whole keyed list in the preview (a list that appears or goes away, or kept items in another
 * order) reads as its items: one added or removed item per key, and the items that differ. It
 * compares the preview's own old and new lists, as the engine does by key; it applies no
 * operation. A reorder alone leaves one change with no values (title and path only).
 */
const splitListChange = (change: ChangePreviewChange): ChangePreviewChange[] => {
    const path = Array.isArray(change.path) ? change.path : []
    const list = path[path.length - 1]
    const field = typeof list === "string" ? LIST_KEY_FIELD[list] : undefined
    if (!field) return [change]
    const before = keyedEntries(field, change.old)
    const after = keyedEntries(field, change.new)
    if (!before || !after) return [change]
    const prefix = path.slice(0, -1)
    const split: ChangePreviewChange[] = []
    for (const key of [...before.keys(), ...[...after.keys()].filter((k) => !before.has(k))]) {
        const old = before.get(key)
        const next = after.get(key)
        if (before.has(key) && after.has(key) && JSON.stringify(old) === JSON.stringify(next))
            continue
        split.push({
            path: [...prefix, {list, key}],
            operation_indexes: change.operation_indexes,
            kind: !before.has(key) ? "added" : !after.has(key) ? "removed" : "changed",
            ...(before.has(key) ? {old} : {}),
            ...(after.has(key) ? {new: next} : {}),
        })
    }
    if (split.length) return split
    const {old: _old, new: _new, ...rest} = change
    return [rest]
}

/** The fields that have a value: a detail never carries `old: undefined`. */
const defined = (fields: {old?: string; new?: string}): {old?: string; new?: string} => ({
    ...(fields.old !== undefined ? {old: fields.old} : {}),
    ...(fields.new !== undefined ? {new: fields.new} : {}),
})

const previewDetail = (
    change: ChangePreviewChange,
    location: Location,
): ApprovalChangeDetail | undefined => {
    if (change.kind !== "changed" && location.wholeItem) {
        return itemDetail(change.kind, location, change.kind === "added" ? change.new : change.old)
    }
    // A change past the size bound keeps only its path: title and path, no values. A field that
    // appears or goes away has only its new or only its old value.
    if (change.old === undefined && change.new === undefined && !change.diff) return undefined
    if (change.diff || location.text || isLongText(change.old) || isLongText(change.new))
        return {
            kind: "text_diff",
            ...defined({old: displayValue(change.old), new: displayValue(change.new)}),
            ...(change.diff ? {diff: change.diff} : {}),
        }
    return {
        kind: "value_change",
        ...(location.label ? {label: location.label} : {}),
        ...defined({
            old: displayValue(change.old, location),
            new: displayValue(change.new, location),
        }),
    }
}

const operationKind = (operation: Record<string, unknown>): ChangeKind =>
    operation.operation === "add_item"
        ? "added"
        : operation.operation === "remove_item"
          ? "removed"
          : "changed"

/** The proposed values of one operation, read from the call's arguments. */
/** The operations whose proposed values the change card can show without a server preview. */
export const OPERATIONS_WITH_VALUES: ReadonlySet<string> = new Set([
    "set",
    "edit_text",
    "add_item",
    "remove_item",
    "remove",
])

const operationDetail = (
    operation: Record<string, unknown>,
    location: Location,
): ApprovalChangeDetail | undefined => {
    const value = operation.value
    switch (operation.operation) {
        case "set":
            if (value === undefined) return undefined
            return location.text || isLongText(value)
                ? {kind: "text_diff", new: displayValue(value), fragmentsOnly: true}
                : {
                      kind: "value_change",
                      ...(location.label ? {label: location.label} : {}),
                      new: displayValue(value, location),
                  }
        case "edit_text": {
            const edits = Array.isArray(operation.edits)
                ? operation.edits.filter(isRecord).map((edit) => ({
                      ...(typeof edit.old_text === "string" ? {old: edit.old_text} : {}),
                      ...(typeof edit.new_text === "string" ? {new: edit.new_text} : {}),
                  }))
                : []
            return {kind: "text_diff", fragmentsOnly: true, edits}
        }
        case "add_item":
            return itemDetail("added", location, value)
        case "remove_item":
            return itemDetail("removed", location, undefined)
        // A field that goes away reads as a removed entry named by the field.
        case "remove":
            if (location.wholeItem) return itemDetail("removed", location, undefined)
            return {
                kind: "item",
                change: "removed",
                name: location.label ?? location.path[location.path.length - 1] ?? "",
            }
        default:
            return undefined
    }
}

export interface DescribedChanges {
    changes: ApprovalChange[]
    proposedValues: boolean
    cannotApply: boolean
    /** The revision the preview was computed on. */
    base?: {revisionId?: string; version?: number}
}

const previewBase = (preview: ChangePreview | null): DescribedChanges["base"] => {
    const base = asRecord(preview?.base)
    if (!base) return undefined
    const version = Number(base.version)
    return {
        ...(typeof base.id === "string" ? {revisionId: base.id} : {}),
        ...(base.version !== undefined && Number.isFinite(version) ? {version} : {}),
    }
}

/**
 * The changes of a call with ordered `operations`. With a preview that applies, one change per
 * changed path, with its old and new values. Without one (or when it cannot apply), one change
 * per operation with the proposed values; when the engine refused it, `cannotApply` is set and
 * the operation it names is marked. The engine's error text is written for the builder, not for
 * the person, so the card does not show it. A pure function: no fetch, no revision read.
 */
export const describeConfigChanges = (
    operations: unknown,
    changePreview?: unknown,
): DescribedChanges => {
    const ops = Array.isArray(operations) ? operations.filter(isRecord) : []
    const preview = parseChangePreview(changePreview)
    const base = previewBase(preview)
    const effect = "version" as const

    if (preview?.applies) {
        const changes = preview.changes
            .flatMap(splitListChange)
            .flatMap(splitObjectChange)
            .map((change): ApprovalChange => {
                const target = Array.isArray(change.path) ? change.path : []
                const source = ops[change.operation_indexes?.[0] ?? -1]
                const location = locateTarget(target, change.new ?? change.old ?? source?.value)
                const detail = previewDetail(change, location)
                return {
                    title: changeTitle(location, change.kind),
                    path: withField(headerPath(location, change.kind), location, detail),
                    section: location.section,
                    ...(detail ? {detail} : {}),
                    effect,
                    risks: risksOf(location, change.kind, change.old, change.new),
                }
            })
        return {changes, proposedValues: false, cannotApply: false, ...(base ? {base} : {})}
    }

    const failing = new Set(
        (preview?.operations ?? [])
            .filter((status) => status.applies === false)
            .map((status) => status.index),
    )
    const changes = ops.map((operation, index): ApprovalChange => {
        const location = locateTarget(
            Array.isArray(operation.target) ? operation.target : [],
            operation.value,
        )
        // `remove` on a list entry takes the whole item away, as `remove_item` does.
        const kind =
            operation.operation === "remove" && location.wholeItem
                ? "removed"
                : operationKind(operation)
        if (kind !== "changed") location.wholeItem = true
        const detail = operationDetail(operation, location)
        return {
            title: changeTitle(location, kind),
            path: withField(headerPath(location, kind), location, detail),
            section: location.section,
            ...(detail ? {detail} : {}),
            effect,
            risks: risksOf(location, kind, undefined, operation.value),
            ...(failing.has(index) ? {fails: true} : {}),
        }
    })
    // Proposed values only when there is no preview at all: a refused one was computed.
    return {
        changes,
        proposedValues: !preview,
        cannotApply: Boolean(preview),
        ...(base ? {base} : {}),
    }
}
