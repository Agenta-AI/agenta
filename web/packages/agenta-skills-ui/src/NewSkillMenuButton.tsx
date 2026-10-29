// The `+ New skill ▾` menu, shared by every creation entry point; no default-click action.
import {scanSkillFromFileList, type SkillUploadScan} from "@agenta/entity-ui/drill-in"
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
    const options: CreateMenuOption[] = [
        {
            kind: "write",
            title: "Write from scratch",
            hint: "Start with an empty SKILL.md and write it here",
            onSelect: onWrite,
        },
    ]
    if (onUpload)
        options.push({
            kind: "upload",
            title: "Upload",
            hint: "A .zip, .skill or SKILL.md, opened in the editor",
            accept: ".zip,.skill,.md,text/markdown,text/plain",
            multiple: true,
            onFiles: (files) => onUpload(scanSkillFromFileList(files)),
        })
    options.push({
        kind: "import",
        title: "Import from a repo",
        hint: "Scan a public GitHub repository for SKILL.md folders",
        onSelect: onImport,
    })
    return <CreateMenuButton label="New skill" options={options} {...button} />
}
