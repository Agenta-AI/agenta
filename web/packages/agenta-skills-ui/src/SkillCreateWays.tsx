import {useRef, useState, type ReactNode} from "react"

import {
    scanSkillFromDataTransfer,
    scanSkillFromFileList,
    type SkillUploadScan,
} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import {cn} from "@agenta/ui/styles"
import {IconTile} from "@agenta/ui/ui"
import {ArrowUp, CaretRight, GithubLogo, PencilSimple} from "@phosphor-icons/react"

const WAY =
    "box-border flex w-full cursor-pointer appearance-none items-center gap-3 rounded-lg border border-solid border-border-muted bg-transparent p-3 text-left font-[inherit] transition-colors duration-[var(--duration-fast)] ease-out hover:bg-accent focus-ring motion-reduce:transition-none"

function Way({
    icon,
    title,
    hint,
    onClick,
    className,
    ...drop
}: {
    icon: ReactNode
    title: string
    hint: string
    onClick: () => void
    className?: string
} & Pick<React.HTMLAttributes<HTMLButtonElement>, "onDragOver" | "onDragLeave" | "onDrop">) {
    return (
        <button type="button" onClick={onClick} className={cn(WAY, className)} {...drop}>
            <IconTile size={32} className="shrink-0">
                {icon}
            </IconTile>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-label font-medium text-foreground">{title}</span>
                <span className="text-meta text-muted-foreground">{hint}</span>
            </span>
            <CaretRight aria-hidden size={14} className="shrink-0 text-muted-foreground" />
        </button>
    )
}

/** The ways to start a skill in a drawer: write, upload (click or drop), import from GitHub. */
export function SkillCreateWays({
    onWrite,
    onUpload,
    onImport,
}: {
    onWrite: () => void
    onUpload: (scan: Promise<SkillUploadScan>) => void
    onImport: () => void
}) {
    const t = useT(skillsAgentCatalog)
    const fileInput = useRef<HTMLInputElement>(null)
    const [over, setOver] = useState(false)
    return (
        <div className="flex flex-col gap-2">
            <Way
                icon={<PencilSimple size={16} />}
                title={t("skills.agent.writeTitle")}
                hint={t("skills.agent.writeHint")}
                onClick={onWrite}
            />
            <Way
                icon={<ArrowUp size={16} />}
                title={t("skills.agent.uploadTitle")}
                hint={t("skills.agent.uploadHint")}
                // The picker must open inside this click, or the browser blocks it.
                onClick={() => fileInput.current?.click()}
                className={cn(over && "border-border bg-accent")}
                onDragOver={(event) => {
                    event.preventDefault()
                    setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(event) => {
                    event.preventDefault()
                    setOver(false)
                    onUpload(scanSkillFromDataTransfer(event.dataTransfer))
                }}
            />
            <Way
                icon={<GithubLogo size={16} />}
                title={t("skills.agent.importTitle")}
                hint={t("skills.agent.importHint")}
                onClick={onImport}
            />
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
        </div>
    )
}
