import {useRef} from "react"

import {scanSkillFromFileList, type SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {FileText, Folder, GithubLogo, PencilSimple} from "@phosphor-icons/react"

import {FeatureActionCard} from "../education/FeatureActionCard"
import {FeatureSection} from "../education/FeatureSection"

/** The empty Skills page's starting points: the New skill menu's three entries, as cards. */
export const SkillCreateOptions = ({
    onWrite,
    onUpload,
    onImport,
}: {
    onWrite: () => void
    onUpload: (scan: Promise<SkillUploadScan>) => void
    onImport: () => void
}) => {
    const fileInput = useRef<HTMLInputElement>(null)

    return (
        <FeatureSection title="Ways to add a skill" hint="Attach skills to any agent once added">
            <div className="grid gap-3 @2xl:grid-cols-3">
                <FeatureActionCard
                    icons={[<PencilSimple key="write" size={15} />]}
                    title="Write from scratch"
                    description="Start from an empty SKILL.md in the editor."
                    actionLabel="Open the editor"
                    meta="In Agenta"
                    onClick={onWrite}
                />
                <FeatureActionCard
                    icons={[<GithubLogo key="github" size={15} />]}
                    title="Import from GitHub"
                    description="Bring skills from a public GitHub repository."
                    actionLabel="Paste a repo URL"
                    meta="GitHub"
                    onClick={onImport}
                />
                <FeatureActionCard
                    icons={[<FileText key="file" size={15} />, <Folder key="folder" size={15} />]}
                    title="Upload a skill"
                    description="Add a .zip, .skill or SKILL.md file."
                    actionLabel="Choose files"
                    meta="Local"
                    // The picker must open inside this click, or the browser blocks it.
                    onClick={() => fileInput.current?.click()}
                />
            </div>
            <input
                ref={fileInput}
                type="file"
                multiple
                accept=".zip,.skill,.md,text/markdown,text/plain"
                className="hidden"
                aria-hidden
                tabIndex={-1}
                onChange={(event) => {
                    const list = event.target.files
                    if (list && list.length) onUpload(scanSkillFromFileList(list))
                    event.target.value = ""
                }}
            />
        </FeatureSection>
    )
}
