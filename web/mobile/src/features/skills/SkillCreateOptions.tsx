import {useRef} from "react"

import {scanSkillFromFileList, type SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
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
    const t = useT(skillsListCatalog)
    const fileInput = useRef<HTMLInputElement>(null)

    return (
        <FeatureSection title={t("skills.list.waysToAdd")} hint={t("skills.list.waysToAddHint")}>
            <div className="grid gap-3 @2xl:grid-cols-3">
                <FeatureActionCard
                    icons={[<PencilSimple key="write" size={15} />]}
                    title={t("skills.list.writeTitle")}
                    description={t("skills.list.writeDescription")}
                    actionLabel={t("skills.list.writeAction")}
                    meta={t("skills.list.writeMeta")}
                    onClick={onWrite}
                />
                <FeatureActionCard
                    icons={[<GithubLogo key="github" size={15} />]}
                    title={t("skills.list.importTitle")}
                    description={t("skills.list.importDescription")}
                    actionLabel={t("skills.list.importAction")}
                    meta={t("skills.list.importMeta")}
                    onClick={onImport}
                />
                <FeatureActionCard
                    icons={[<FileText key="file" size={15} />, <Folder key="folder" size={15} />]}
                    title={t("skills.list.uploadTitle")}
                    description={t("skills.list.uploadDescription")}
                    actionLabel={t("skills.list.uploadAction")}
                    meta={t("skills.list.uploadMeta")}
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
