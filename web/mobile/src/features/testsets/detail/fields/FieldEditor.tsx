import {useCallback, useMemo} from "react"

import {ValueField} from "@agenta/chat/value-view"
import {parseCodeString} from "@agenta/entity-ui/testcase"
import type {ViewType} from "@agenta/entity-ui/view-types"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {isPlainObject, parseStructuredJson} from "@agenta/shared/utils"
import {MessagesField} from "@agenta/ui/drill-in"

import {ChipsField} from "./ChipsField"
import {CodeField} from "./CodeField"
import {KeyRowsField} from "./KeyRowsField"
import type {FieldEditorKind, FieldEditorPick} from "./pickFieldEditor"
import {NumberInput, TrueFalseSwitch} from "./ScalarFields"
import {TextAreaField} from "./TextAreaField"

const NOT_JSON = Symbol("not JSON")

/** A scalar as the text its input shows; null and a missing value show nothing. */
const fieldText = (value: unknown) =>
    value === null || value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value)

/**
 * The editor of one field, as `kind` says. The boolean, number and chat editors are the drill-in
 * ones; an edit keeps the type of the value (a number stays a number, a switch stores a boolean,
 * a text input stores a string). A string that holds JSON is stored as text again.
 */
export const FieldEditor = ({
    name,
    value,
    pick,
    kind,
    view,
    markdownEdit,
    mono = false,
    collapseSignal,
    onChange,
}: {
    name: string
    value: unknown
    pick: FieldEditorPick
    kind: FieldEditorKind
    view: ViewType
    markdownEdit: boolean
    /** An identifier: the inline input uses the mono font. */
    mono?: boolean
    collapseSignal: number
    onChange?: (next: unknown) => void
}) => {
    const t = useT(valueViewCatalog)
    const setValue = useCallback((_path: string[], next: unknown) => onChange?.(next), [onChange])
    const text = fieldText(value)
    // JSON written as text edits as its parsed value and is stored as text again, while the
    // stored value is still a string (an outside update to an object makes edits store objects).
    const asText = pick.parsedFromText && typeof value === "string"
    // Parsed once per stored text: a render for another field is then not an outside change,
    // and a typed draft stays. Valid JSON is read as the editor reads it (a typed `5` is 5, a
    // typed JSON string stays a string); the shape rule's reading (code fences, loose JSON)
    // serves only text that is not valid JSON.
    const parsed = useMemo(() => {
        if (!asText) return value
        const strict = parseCodeString<unknown>(value as string, "json", NOT_JSON)
        return strict !== NOT_JSON ? strict : (parseStructuredJson(value as string) ?? value)
    }, [asText, value])

    switch (kind) {
        case "boolean":
            return typeof value === "boolean" && onChange ? (
                <TrueFalseSwitch name={name} value={value} onChange={onChange} />
            ) : (
                <ValueField value={value} label={name} />
            )
        case "number":
            return typeof value === "number" && onChange ? (
                <NumberInput name={name} value={value} onChange={onChange} />
            ) : (
                <ValueField value={value} label={name} />
            )
        case "text":
            return (
                <input
                    aria-label={name}
                    value={text}
                    placeholder={
                        value === null || value === "" ? t("chat.valueView.emptyText") : undefined
                    }
                    className={`-ml-2 block h-7 w-[calc(100%+8px)] truncate ${mono ? "font-mono" : ""} rounded-md border border-transparent bg-transparent px-1.75 text-body text-foreground outline-none placeholder:text-muted-foreground hover:border-border focus:border-border-strong focus:bg-background`}
                    onChange={(event) => onChange?.(event.target.value)}
                />
            )
        case "textArea":
            return onChange ? (
                <TextAreaField
                    name={name}
                    text={text}
                    collapseSignal={collapseSignal}
                    onChange={onChange}
                />
            ) : (
                <ValueField value={value} label={name} />
            )
        case "markdown":
            return markdownEdit && onChange ? (
                <TextAreaField
                    name={name}
                    text={text}
                    collapseSignal={collapseSignal}
                    onChange={onChange}
                />
            ) : (
                <ValueField value={value} label={name} />
            )
        case "chips":
            return Array.isArray(value) ? (
                <ChipsField items={value} collapseSignal={collapseSignal} onChange={onChange} />
            ) : (
                <ValueField value={value} label={name} />
            )
        case "keyRows":
            return isPlainObject(value) ? (
                <KeyRowsField value={value} collapseSignal={collapseSignal} onChange={onChange} />
            ) : (
                <ValueField value={value} label={name} />
            )
        case "messages":
            return onChange ? (
                <MessagesField
                    item={{key: name, name, value}}
                    stringValue={JSON.stringify(value ?? [])}
                    fullPath={[name]}
                    setValue={setValue}
                    valueMode="native"
                />
            ) : (
                <ValueField value={value} label={name} />
            )
        case "code": {
            const format = view === "yaml" ? "yaml" : "json"
            // JSON written as text is stored as the typed JSON, as it is. Each format has its
            // own draft: the JSON text is not the YAML editor's text.
            return (
                <CodeField
                    key={format}
                    id={name}
                    value={parsed}
                    format={format}
                    onChange={
                        onChange
                            ? (next, typed) =>
                                  onChange(
                                      asText
                                          ? format === "json"
                                              ? typed
                                              : JSON.stringify(next, null, 2)
                                          : next,
                                  )
                            : undefined
                    }
                />
            )
        }
    }
}
