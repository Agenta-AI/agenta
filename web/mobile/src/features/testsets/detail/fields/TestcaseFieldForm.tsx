import {useCallback, useRef, useState} from "react"

import {ValueField, valueAsText} from "@agenta/chat/value-view"
import type {ViewType} from "@agenta/entity-ui/view-types"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import editorCatalog from "@agenta/i18n/catalogs/testsets.testcaseEditor"
import {Button, Segmented} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"

import {FieldEditor, fieldText} from "./FieldEditor"
import {FieldMenu, type FieldColumnActions} from "./FieldMenu"
import {editorKind, isIdKey, pickFieldEditor, type FieldEditorPick} from "./pickFieldEditor"

export type {FieldColumnActions} from "./FieldMenu"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const countOf = (value: unknown) =>
    Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : 0

/** The muted word after a section name: what the value is, with its size. */
const useTypeHint = () => {
    const t = useT(editorCatalog)
    return (pick: FieldEditorPick, value: unknown) => {
        if (pick.parsedFromText) return t("testsets.testcaseEditor.typeJson")
        const count = countOf(value)
        switch (pick.shape) {
            case "markdown":
                return t("testsets.testcaseEditor.typeMarkdown")
            case "text-long":
                return t("testsets.testcaseEditor.typeLongText")
            case "array-scalars":
                return t("testsets.testcaseEditor.typeList", {count})
            case "array-objects":
                return t("testsets.testcaseEditor.typeListOfObjects", {count})
            case "messages":
                return Array.isArray(value)
                    ? t("testsets.testcaseEditor.typeChat", {count})
                    : t("testsets.testcaseEditor.typeObject", {count})
            case "message":
            case "object-flat":
            case "object-nested":
                return t("testsets.testcaseEditor.typeObject", {count})
            default:
                return t("testsets.testcaseEditor.typeText")
        }
    }
}

/**
 * The test case as a form: the short values in a two-column grid, every other value as a section
 * below, each in the test set column order. The editor of each field is picked from its value
 * the first time the form sees the field, so it does not change while the user types. With no
 * `onFieldChange` the form is view only: the same layout, values drawn by `ValueField`, and a
 * menu with Show as and Copy value only.
 */
export const TestcaseFieldForm = ({
    value,
    onFieldChange,
    columnActions,
    onAddField,
    collapseSignal,
}: {
    value: Record<string, unknown>
    onFieldChange?: (key: string, next: unknown) => void
    columnActions?: (key: string) => FieldColumnActions | null
    onAddField?: () => void
    collapseSignal: number
}) => {
    const t = useT(editorCatalog)
    const tv = useT(valueViewCatalog)
    const typeHint = useTypeHint()
    const picks = useRef(new Map<string, FieldEditorPick>())
    const [views, setViews] = useState<Record<string, ViewType>>({})
    const [editing, setEditing] = useState<Record<string, boolean>>({})
    const setView = useCallback(
        (key: string, view: ViewType) => setViews((current) => ({...current, [key]: view})),
        [],
    )
    const viewOnly = !onFieldChange

    const fields = Object.keys(value).map((key) => {
        let pick = picks.current.get(key)
        if (!pick) {
            pick = pickFieldEditor(value[key])
            picks.current.set(key, pick)
        }
        const view = views[key] ?? pick.defaultView
        return {key, pick, view, kind: editorKind(pick, view)}
    })
    const inGrid = (field: (typeof fields)[number]) =>
        field.pick.grid && field.view === field.pick.defaultView

    const menu = (field: (typeof fields)[number]) => (
        <FieldMenu
            name={field.key}
            views={field.pick.views}
            view={field.view}
            list={field.pick.shape === "array-scalars"}
            onViewChange={(view) => setView(field.key, view)}
            onCopy={() => void copyToClipboard(valueAsText(value[field.key]))}
            column={viewOnly ? null : (columnActions?.(field.key) ?? null)}
        />
    )

    const editor = (field: (typeof fields)[number]) => {
        const item = value[field.key]
        // View only draws the value with the shared renderer, except a code view the user chose.
        if (viewOnly && field.kind !== "code") return <ValueField value={item} label={field.key} />
        return (
            <FieldEditor
                name={field.key}
                value={item}
                pick={field.pick}
                kind={field.kind}
                view={field.view}
                markdownEdit={editing[field.key] === true}
                mono={isIdKey(field.key)}
                collapseSignal={collapseSignal}
                onChange={onFieldChange ? (next) => onFieldChange(field.key, next) : undefined}
            />
        )
    }

    const gridFields = fields.filter(inGrid)
    const sections = fields.filter((field) => !inGrid(field))

    return (
        <div className="flex flex-col gap-5 px-5 pb-6 pt-4">
            {gridFields.length > 0 ? (
                <div className="grid grid-cols-1 gap-x-6 border-t border-border-muted sm:grid-cols-2">
                    {gridFields.map((field) => (
                        <div
                            key={field.key}
                            className="group/field grid min-h-9 grid-cols-[128px_minmax(0,1fr)_20px] items-center gap-1.5 border-b border-border-muted pl-1"
                        >
                            <span
                                className="truncate text-body text-muted-foreground"
                                title={field.key}
                            >
                                {field.key}
                            </span>
                            <div className="min-w-0">
                                {viewOnly ? (
                                    <span
                                        className={`block truncate text-body ${
                                            fieldText(value[field.key]) === ""
                                                ? "text-muted-foreground"
                                                : "text-foreground"
                                        } ${field.pick.shape === "number" ? "text-right tabular-nums" : ""} ${
                                            isIdKey(field.key) ? "font-mono" : ""
                                        }`}
                                    >
                                        {fieldText(value[field.key]) ||
                                            tv("chat.valueView.emptyText")}
                                    </span>
                                ) : (
                                    editor(field)
                                )}
                            </div>
                            {menu(field)}
                        </div>
                    ))}
                </div>
            ) : null}
            {sections.map((field) => (
                <section
                    key={field.key}
                    aria-label={field.key}
                    className="group/field flex min-w-0 flex-col gap-1.5"
                >
                    <div className="flex min-h-6 items-center gap-1.5 pl-1">
                        <span className="text-body text-muted-foreground">{field.key}</span>
                        <span className="text-caption text-muted-foreground opacity-75">
                            {typeHint(field.pick, value[field.key])}
                        </span>
                        <span className="flex-1" />
                        {field.kind === "markdown" && !viewOnly ? (
                            <MarkdownModeSwitch
                                edit={editing[field.key] === true}
                                onChange={(edit) =>
                                    setEditing((current) => ({...current, [field.key]: edit}))
                                }
                            />
                        ) : null}
                        {menu(field)}
                    </div>
                    {editor(field)}
                </section>
            ))}
            {onAddField && !viewOnly ? (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start border-dashed text-muted-foreground"
                    onClick={onAddField}
                >
                    + {t("testsets.testcaseEditor.addField")}
                </Button>
            ) : null}
        </div>
    )
}

const MarkdownModeSwitch = ({
    edit,
    onChange,
}: {
    edit: boolean
    onChange: (edit: boolean) => void
}) => {
    const t = useT(editorCatalog)
    return (
        <Segmented
            size="compact"
            options={[
                {value: "preview", label: t("testsets.testcaseEditor.preview")},
                {value: "edit", label: t("testsets.testcaseEditor.edit")},
            ]}
            value={edit ? "edit" : "preview"}
            onChange={(next) => onChange(next === "edit")}
        />
    )
}
