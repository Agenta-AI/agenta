// The `+ New skill ▾` menu, shared by every creation entry point; no default-click action.
import {scanSkillFromFileList, type SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {CreateMenuButton, type CreateMenuOption} from "@agenta/ui/create-menu"

export interface NewSkillMenuButtonProps {
    onWrite: () => void
    /**
     * Upload opens the file picker straight away; the scan of what was picked arrives here, so
     * the host can open the editor on it. Absent ⇒ no Upload row.
     */
    onUpload?: (scan: Promise<SkillUploadScan>) => void
    onImport: () => void
    disabled?: boolean
    /** "outline" for in-drawer placements; "default" for the page header. */
    variant?: "default" | "outline"
    /** Layout classes from the placement — e.g. the toolbar pinning it to the right edge. */
    className?: string
}

export function NewSkillMenuButton({
    onWrite,
    onUpload,
    onImport,
    ...button
}: NewSkillMenuButtonProps) {
    const t = useT(skillsGalleryCatalog)
    const options: CreateMenuOption[] = [
        {
            kind: "write",
            title: t("skills.gallery.menuWriteTitle"),
            hint: t("skills.gallery.menuWriteHint"),
            onSelect: onWrite,
        },
    ]
    if (onUpload)
        options.push({
            kind: "upload",
            title: t("skills.gallery.menuUploadTitle"),
            hint: t("skills.gallery.menuUploadHint"),
            accept: ".zip,.skill,.md,text/markdown,text/plain",
            multiple: true,
            onFiles: (files) => onUpload(scanSkillFromFileList(files)),
        })
    options.push({
        kind: "import",
        title: t("skills.gallery.menuImportTitle"),
        hint: t("skills.gallery.menuImportHint"),
        onSelect: onImport,
    })
    return <CreateMenuButton label={t("skills.gallery.newSkill")} options={options} {...button} />
}
