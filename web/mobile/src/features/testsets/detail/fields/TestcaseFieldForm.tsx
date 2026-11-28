import {useCallback, useRef, useState} from "react"

import {ValueField, valueAsText} from "@agenta/chat/value-view"
import type {ViewType} from "@agenta/entity-ui/view-types"
import {useT} from "@agenta/i18n"
import editorCatalog from "@agenta/i18n/catalogs/testsets.testcaseEditor"
import {isPlainObject} from "@agenta/shared/utils"
import {Button, Segmented} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"

import {FieldEditor} from "./FieldEditor"
import {FieldMenu, type FieldColumnActions} from "./FieldMenu"
import {
    editorKind,
    fitsEditor,
    isIdKey,
    pickFieldEditor,
    type FieldEditorPick,
} from "./pickFieldEditor"

const countOf = (value: unknown) =>
    Array.isArray(value) ? value.length : isPlainObject(value) ? Object.keys(value).length : 0

/** The muted word after a section name: what the value is, with its size. */
const useTypeHint = () => {
    const t = useT(editorCatalog)
    return (pick: FieldEditorPick, view: ViewType, value: unknown) => {
        // The word follows the view the field shows in.
        if (view === "json") return t("testsets.testcaseEditor.typeJson")
        if (view === "yaml") return t("testsets.testcaseEditor.typeYaml")
        if (view === "markdown") return t("testsets.testcaseEditor.typeMarkdown")
        const count = countOf(value)
        switch (pick.shape) {
            case "text-short":
            case "text-long":
            case "markdown":
                // A text outside the grid is a long text: several lines or a long line.
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
    sectionKeys,
}: {
    value: Record<string, unknown>
    onFieldChange?: (key: string, next: unknown) => void
    columnActions?: (key: string) => FieldColumnActions | null
    onAddField?: () => void
    collapseSignal: number
    /** Columns drawn as sections in every test case (`sectionColumnKeys`). */
    sectionKeys?: ReadonlySet<string>
}) => {
    const t = useT(editorCatalog)
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
        const chosen = views[key]
        let view = chosen && pick?.views.includes(chosen) ? chosen : pick?.defaultView
        // A value that no longer fits its editor gets a new one, in its first view.
        if (!pick || !view || !fitsEditor(editorKind(pick, view), value[key])) {
            pick = pickFieldEditor(value[key])
            if (sectionKeys?.has(key)) pick = {...pick, grid: false}
            picks.current.set(key, pick)
            view = chosen && pick.views.includes(chosen) ? chosen : pick.defaultView
            if (!fitsEditor(editorKind(pick, view), value[key])) view = pick.defaultView
        }
        return {key, pick, view, kind: editorKind(pick, view)}
    })
    const inGrid = (field: (typeof fields)[number]) =>
        field.pick.grid && field.view === field.pick.defaultView

    const menu = (field: (typeof fields)[number]) => (
        <FieldMenu
            name={field.key}
            // View only draws text and markdown alike with `ValueField`, so a reader picks
            // between the first view and the code views only.
            views={
                viewOnly
                    ? field.pick.views.filter(
                          (view) =>
                              view === field.pick.defaultView || view === "json" || view === "yaml",
                      )
                    : field.pick.views
            }
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
                            <div
                                className={`min-w-0 ${field.pick.shape === "number" ? "text-right tabular-nums" : ""} ${
                                    isIdKey(field.key) ? "font-mono" : ""
                                }`}
                            >
                                {editor(field)}
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
                            {typeHint(field.pick, field.view, value[field.key])}
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
