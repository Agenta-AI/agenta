// The `+ New skill ▾` menu, shared by every creation entry point; no default-click action.
import {scanSkillFromFileList, type SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {CREATE_MENU_COLORS, CreateMenuButton, type CreateMenuOption} from "@agenta/ui/create-menu"
import {GitBranch, PencilSimple, UploadSimple} from "@phosphor-icons/react"

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
    /** Per-entry gating while flows ship incrementally; every entry defaults available. */
    availability?: {write?: boolean; upload?: boolean; import?: boolean}
    /** Layout classes from the placement — e.g. the toolbar pinning it to the right edge. */
    className?: string
}

export function NewSkillMenuButton({
    onWrite,
    onUpload,
    onImport,
    availability,
    ...button
}: NewSkillMenuButtonProps) {
    const options: CreateMenuOption[] = [
        {
            key: "write",
            color: CREATE_MENU_COLORS.write,
            icon: <PencilSimple size={15} />,
            title: "Write from scratch",
            hint: "Start with an empty SKILL.md and write it here",
            onSelect: onWrite,
            disabled: availability?.write === false,
        },
        ...(onUpload
            ? [
                  {
                      key: "upload",
                      color: CREATE_MENU_COLORS.upload,
                      icon: <UploadSimple size={15} />,
                      title: "Upload",
                      hint: "A .zip, .skill or SKILL.md, opened in the editor",
                      accept: ".zip,.skill,.md,text/markdown,text/plain",
                      multiple: true,
                      onFiles: (files: FileList) => onUpload(scanSkillFromFileList(files)),
                      disabled: availability?.upload === false,
                      separated: true,
                  },
              ]
            : []),
        {
            key: "import",
            color: CREATE_MENU_COLORS.import,
            icon: <GitBranch size={15} />,
            title: "Import from a repo",
            hint: "Scan a public GitHub repository for SKILL.md folders",
            onSelect: onImport,
            disabled: availability?.import === false,
            separated: !onUpload,
        },
    ]
    return <CreateMenuButton label="New skill" options={options} {...button} />
}
