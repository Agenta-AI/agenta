import {useRef, type ReactNode} from "react"

import {scanSkillFromFileList, type SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {GithubLogo, PencilSimple, UploadSimple} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {FeatureActionCard} from "../education/FeatureActionCard"
import {FeatureSection} from "../education/FeatureSection"

/** The same colored tiles as the New skill chooser. */
const tile = (className: string, icon: ReactNode) => (
    <span
        aria-hidden
        className={cn(
            "box-border inline-flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border border-solid",
            className,
        )}
    >
        {icon}
    </span>
)

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
                    media={tile("border-colorInfo/20 bg-colorInfoBg text-colorInfo", <PencilSimple size={15} />)}
                    title={t("skills.list.writeTitle")}
                    description={t("skills.list.writeDescription")}
                    actionLabel={t("skills.list.writeAction")}
                    meta={t("skills.list.writeMeta")}
                    onClick={onWrite}
                />
                <FeatureActionCard
                    media={tile("border-foreground bg-foreground text-background", <GithubLogo size={15} />)}
                    title={t("skills.list.importTitle")}
                    description={t("skills.list.importDescription")}
                    actionLabel={t("skills.list.importAction")}
                    meta={t("skills.list.importMeta")}
                    onClick={onImport}
                />
                <FeatureActionCard
                    media={tile(
                        "border-tag-green/20 bg-tag-green-bg text-tag-green",
                        <UploadSimple size={15} />,
                    )}
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
