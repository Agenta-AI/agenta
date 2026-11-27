import {useCallback} from "react"

import {ValueField} from "@agenta/chat/value-view"
import type {ViewType} from "@agenta/entity-ui/view-types"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {parseStructuredJson} from "@agenta/shared/utils"
import {MessagesField, NumberField} from "@agenta/ui/drill-in"
import {Segmented} from "@agenta/ui/ui"

import {ChipsField} from "./ChipsField"
import {CodeField} from "./CodeField"
import {KeyRowsField} from "./KeyRowsField"
import type {FieldEditorKind, FieldEditorPick} from "./pickFieldEditor"
import {TextAreaField} from "./TextAreaField"

/** A scalar as the text its input shows; null and a missing value show nothing. */
export const fieldText = (value: unknown) =>
    value === null || value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const BOOLEAN_OPTIONS = [
    // The JSON values themselves, not words: they read the same in every language.
    {value: "true", label: "true"},
    {value: "false", label: "false"},
]

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

    switch (kind) {
        case "boolean":
            return (
                <Segmented
                    size="compact"
                    aria-label={name}
                    options={BOOLEAN_OPTIONS}
                    value={value === true ? "true" : "false"}
                    disabled={!onChange}
                    onChange={(next) => onChange?.(next === "true")}
                />
            )
        case "number":
            return (
                <div className="[&_[data-slot=input-number]]:border-transparent [&_[data-slot=input-number]]:bg-transparent [&_[data-slot=input-number]:hover]:border-border [&_input]:text-right">
                    <NumberField
                        item={{key: name, name, value}}
                        stringValue={text}
                        fullPath={[name]}
                        setValue={setValue}
                        valueMode="native"
                    />
                </div>
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
            return (
                <ChipsField
                    items={Array.isArray(value) ? value : []}
                    collapseSignal={collapseSignal}
                    onChange={onChange}
                />
            )
        case "keyRows":
            return isRecord(value) ? (
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
            // JSON written as text edits as its parsed value and is stored as text again.
            const parsed =
                pick.parsedFromText && typeof value === "string"
                    ? (parseStructuredJson(value) ?? value)
                    : value
            return (
                <CodeField
                    id={name}
                    value={parsed}
                    format={format}
                    onChange={
                        onChange
                            ? (next, typed) =>
                                  onChange(
                                      pick.parsedFromText
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
