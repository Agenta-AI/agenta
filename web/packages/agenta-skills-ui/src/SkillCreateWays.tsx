import {useRef, useState, type ReactNode} from "react"

import {
    scanSkillFromDataTransfer,
    scanSkillFromFileList,
    type SkillUploadScan,
} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import {cn} from "@agenta/ui/styles"
import {IconTile, Spinner} from "@agenta/ui/ui"
import {CaretRight, GithubLogo, PencilSimple, UploadSimple} from "@phosphor-icons/react"

// A filled row: its edge is visible at rest, so it sits on the alignment line (ALIGN-01).
const WAY =
    "box-border flex min-h-row-double w-full cursor-pointer appearance-none items-center gap-3 rounded-lg border-0 bg-muted px-3 py-2 text-left font-[inherit] transition-colors duration-[var(--duration-fast)] ease-out enabled:hover:bg-accent focus-ring disabled:cursor-default disabled:opacity-60 motion-reduce:transition-none"

function Way({
    icon,
    title,
    hint,
    onClick,
    className,
    disabled,
    busy,
    ...drop
}: {
    icon: ReactNode
    title: string
    hint: string
    onClick: () => void
    className?: string
    disabled?: boolean
    /** This way is reading: a spinner in place of the caret. */
    busy?: boolean
} & Pick<React.HTMLAttributes<HTMLButtonElement>, "onDragOver" | "onDragLeave" | "onDrop">) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(WAY, className)}
            {...drop}
        >
            <IconTile size={32}>{icon}</IconTile>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-label font-medium text-foreground">{title}</span>
                <span className="text-meta text-muted-foreground">{hint}</span>
            </span>
            {busy ? (
                <Spinner size="default" className="shrink-0 text-muted-foreground" />
            ) : (
                <CaretRight aria-hidden size={16} className="shrink-0 text-muted-foreground" />
            )}
        </button>
    )
}

/** The ways to start a skill, on the create page and in a drawer: write, upload (click or drop), import from GitHub. */
export function SkillCreateWays({
    onWrite,
    onUpload,
    onImport,
    busy,
}: {
    onWrite: () => void
    onUpload: (scan: Promise<SkillUploadScan>) => void
    onImport: () => void
    /** An upload is being read: the Upload row spins and every way waits. */
    busy?: boolean
}) {
    const t = useT(skillsAgentCatalog)
    const fileInput = useRef<HTMLInputElement>(null)
    const [over, setOver] = useState(false)
    return (
        // A drop just off the Upload row must not open the file in the browser.
        <div
            className="flex flex-col gap-2"
            aria-busy={busy || undefined}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => event.preventDefault()}
        >
            <Way
                icon={<PencilSimple size={16} />}
                title={t("skills.agent.writeTitle")}
                hint={t("skills.agent.writeHint")}
                onClick={onWrite}
                disabled={busy}
            />
            <Way
                icon={<UploadSimple size={16} />}
                title={t("skills.agent.uploadTitle")}
                hint={t("skills.agent.uploadHint")}
                // The picker must open inside this click, or the browser blocks it.
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                busy={busy}
                className={cn(over && "bg-accent")}
                onDragOver={(event) => {
                    event.preventDefault()
                    if (!busy) setOver(true)
                }}
                onDragLeave={(event) => {
                    // Moving onto the row's own children is not a leave.
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                    setOver(false)
                }}
                onDrop={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setOver(false)
                    if (!busy) onUpload(scanSkillFromDataTransfer(event.dataTransfer))
                }}
            />
            <Way
                icon={<GithubLogo size={16} />}
                title={t("skills.agent.importTitle")}
                hint={t("skills.agent.importHint")}
                onClick={onImport}
                disabled={busy}
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
