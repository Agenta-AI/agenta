/**
 * The upload step of the skill view (F07 f7): a drop zone and the choice "Add to this skill"
 * (default) or "Replace the whole skill". "Upload" applies the upload to the draft; nothing is
 * saved until the view's Save.
 */
import {useRef, useState} from "react"

import {richText, useT} from "@agenta/i18n"
import skillTemplateCatalog from "@agenta/i18n/catalogs/entityUi.skillTemplate"
import skillViewCatalog from "@agenta/i18n/catalogs/entityUi.skillView"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {cn} from "@agenta/ui/styles"
import {Button, RadioGroup, RadioGroupItem, Spinner} from "@agenta/ui/ui"
import {File as FileIcon, UploadSimple} from "@phosphor-icons/react"

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
}

export function SkillUploadStep({fileCount, onUpload, onCancel}: SkillUploadStepProps) {
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
                    "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-colorBorderSecondary px-4 py-6 text-center transition-colors",
                    over && "border-[var(--ag-c-586673)] bg-[var(--ag-c-F5F7FA)]",
                )}
            >
                {busy ? (
                    <Spinner size="small" />
                ) : (
                    <UploadSimple size={20} className="text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground">
                    {richText(t("entityUi.skillTemplate.dragHint"), {
                        mono: (text) => <span className="font-mono">{text}</span>,
                    })}{" "}
                    {t("entityUi.skillView.or")}
                </span>
                <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
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
                className="gap-3"
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
                    <label key={value} className="flex cursor-pointer items-start gap-2">
                        <RadioGroupItem value={value} className="mt-0.5" />
                        <span className="flex flex-col gap-0.5">
                            <span className="text-sm">{title}</span>
                            <span className="text-xs text-muted-foreground">{hint}</span>
                        </span>
                    </label>
                ))}
            </RadioGroup>
            <span className="text-xs text-muted-foreground">
                {t("entityUi.skillView.textOnly")}
            </span>
            {error ? <span className="text-xs text-[var(--ag-colorError)]">{error}</span> : null}
            <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onCancel}>
                    {t("entityUi.skillView.cancel")}
                </Button>
                <Button onClick={apply} disabled={!upload || busy}>
                    {t("entityUi.skillView.upload")}
                </Button>
            </div>
        </div>
    )
}
