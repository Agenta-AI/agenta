/**
 * The upload step of the skill view (F07 f7): a drop zone and the choice "Add to this skill"
 * (default) or "Replace the whole skill". "Upload" applies the upload to the draft; nothing is
 * saved until the view's Save. In a view, Cancel and Upload are the view's own action row
 * (`useSkillViewForm`); elsewhere the step draws them.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {richText, useT} from "@agenta/i18n"
import skillTemplateCatalog from "@agenta/i18n/catalogs/entityUi.skillTemplate"
import skillViewCatalog from "@agenta/i18n/catalogs/entityUi.skillView"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {cn} from "@agenta/ui/styles"
import {Button, RadioGroup, RadioGroupItem, Spinner} from "@agenta/ui/ui"
import {useViewForm, type ViewForm} from "@agenta/ui/view-stack"
import {ArrowUp, File as FileIcon} from "@phosphor-icons/react"

import {
    readSkillUploadFromDataTransfer,
    readSkillUploadFromFileList,
    type SkillUpload,
    type SkillUploadMode,
} from "./skillUpload"

export interface SkillUploadStepProps {
    /** Files the skill has now, for the "Replace" line. */
    fileCount: number
    /** Apply the upload. Resolves an error text, or null when it was applied. */
    onUpload: (upload: SkillUpload, mode: SkillUploadMode) => string | null
    onCancel: () => void
    /**
     * Report the step to the view's action row instead of drawing Cancel and Upload here (F07 f7:
     * the two buttons are the footer's). Null when the step closes.
     */
    onControl?: (control: SkillUploadControl | null) => void
}

/** The upload step as the view's action row drives it. */
export interface SkillUploadControl {
    /** A file was read and nothing is still reading. */
    ready: boolean
    upload: () => void
    cancel: () => void
}

/**
 * `useViewForm` for a view that shows `SkillFormView`: while its upload step is open, the action
 * row reads Cancel and Upload and runs the step. Pass `onUploadControl` to the form.
 */
export function useSkillViewForm(form: ViewForm, uploadLabel: string) {
    const [control, setControl] = useState<SkillUploadControl | null>(null)
    useViewForm(
        control
            ? {
                  ...form,
                  dirty: form.dirty || control.ready,
                  valid: control.ready,
                  saveLabel: uploadLabel,
                  savingLabel: undefined,
                  save: async () => {
                      control.upload()
                      // The step closes by itself; the view stays open with the draft.
                      return "stay"
                  },
                  cancel: control.cancel,
              }
            : form,
    )
    return {onUploadControl: setControl}
}

export function SkillUploadStep({fileCount, onUpload, onCancel, onControl}: SkillUploadStepProps) {
    const t = useT(skillViewCatalog, skillTemplateCatalog, skillsGalleryCatalog)
    const inputRef = useRef<HTMLInputElement>(null)
    const [mode, setMode] = useState<SkillUploadMode>("add")
    const [over, setOver] = useState(false)
    const [busy, setBusy] = useState(false)
    const [upload, setUpload] = useState<SkillUpload | null>(null)
    const [label, setLabel] = useState("")
    const [error, setError] = useState<string | null>(null)

    const read = async (pick: () => Promise<SkillUpload>, name: string) => {
        setBusy(true)
        setError(null)
        try {
            setUpload(await pick())
            setLabel(name)
        } catch {
            setUpload(null)
            setError(t("skills.gallery.readUploadFailed"))
        } finally {
            setBusy(false)
        }
    }

    const apply = () => {
        if (!upload) return
        setError(onUpload(upload, mode))
    }

    // The view's row calls the latest apply and cancel.
    const applyRef = useRef(apply)
    applyRef.current = apply
    const cancelRef = useRef(onCancel)
    cancelRef.current = onCancel
    const ready = Boolean(upload) && !busy
    const report = useCallback((next: SkillUploadControl | null) => onControl?.(next), [onControl])
    useEffect(() => {
        if (!onControl) return
        report({ready, upload: () => applyRef.current(), cancel: () => cancelRef.current()})
    }, [onControl, ready, report])
    useEffect(() => () => report(null), [report])

    return (
        <div className="flex flex-col gap-4">
            <div
                onDragOver={(event) => {
                    event.preventDefault()
                    setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(event) => {
                    event.preventDefault()
                    setOver(false)
                    const dt = event.dataTransfer
                    const first = dt.files[0]?.name ?? ""
                    void read(() => readSkillUploadFromDataTransfer(dt), first)
                }}
                className={cn(
                    "flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-colorBorder bg-[var(--ag-surface-raised)] px-4 py-7 text-center transition-colors",
                    over && "border-[var(--ag-c-586673)] bg-[var(--ag-c-F5F7FA)]",
                )}
            >
                {busy ? <Spinner size="small" /> : <ArrowUp size={16} className="text-colorText" />}
                <span className="text-[13px] font-medium leading-5 text-colorText">
                    {richText(t("entityUi.skillTemplate.dragHint"), {
                        mono: (text) => <span className="font-mono">{text}</span>,
                    })}
                </span>
                <span className="text-[12px] leading-4 text-colorTextSecondary">
                    {t("entityUi.skillView.or")}
                </span>
                <Button
                    variant="outline"
                    size="compact"
                    onClick={() => inputRef.current?.click()}
                    disabled={busy}
                >
                    {t("entityUi.skillTemplate.browseFiles")}
                </Button>
                {upload ? (
                    <span className="flex items-center gap-1 text-xs">
                        <FileIcon size={13} className="text-muted-foreground" />
                        <span className="font-mono">{label}</span>
                        <span className="text-muted-foreground">
                            ·{" "}
                            {t("skills.gallery.filesParsed", {
                                count: upload.skill.files.length + (upload.hasSkillMd ? 1 : 0),
                            })}
                        </span>
                    </span>
                ) : null}
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept=".zip,.skill,.md,text/markdown,text/plain"
                    className="hidden"
                    onChange={(event) => {
                        const list = event.target.files
                        if (list && list.length) {
                            const files = Array.from(list)
                            void read(() => readSkillUploadFromFileList(files), files[0].name)
                        }
                        event.target.value = ""
                    }}
                />
            </div>

            <RadioGroup
                value={mode}
                onValueChange={(value) => setMode(value as SkillUploadMode)}
                className="gap-2"
            >
                {(
                    [
                        [
                            "add",
                            t("entityUi.skillView.addToSkill"),
                            t("entityUi.skillView.addToSkillHint"),
                        ],
                        [
                            "replace",
                            t("entityUi.skillView.replaceSkill"),
                            t("entityUi.skillView.replaceSkillHint", {count: fileCount}),
                        ],
                    ] as const
                ).map(([value, title, hint]) => (
                    // Bordered option cards; the picked one has a dark border (F07 f7).
                    <label
                        key={value}
                        className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-solid px-3 py-3",
                            mode === value
                                ? "border-colorText bg-[var(--ag-surface-raised)]"
                                : "border-colorBorderSecondary bg-colorBgContainer",
                        )}
                    >
                        <RadioGroupItem value={value} className="mt-0.5" />
                        <span className="flex flex-col gap-0.5">
                            <span className="text-[13px] font-semibold leading-5 text-colorText">
                                {title}
                            </span>
                            <span className="text-[12px] leading-4 text-colorTextSecondary">
                                {hint}
                            </span>
                        </span>
                    </label>
                ))}
            </RadioGroup>
            <span className="text-[12px] leading-4 text-colorTextTertiary">
                {t("entityUi.skillView.textOnly")}
            </span>
            {error ? <span className="text-xs text-[var(--ag-colorError)]">{error}</span> : null}
            {onControl ? null : (
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        {t("entityUi.skillView.cancel")}
                    </Button>
                    <Button onClick={apply} disabled={!ready}>
                        {t("entityUi.skillView.upload")}
                    </Button>
                </div>
            )}
        </div>
    )
}
