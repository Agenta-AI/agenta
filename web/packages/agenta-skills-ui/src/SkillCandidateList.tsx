import {useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {cn} from "@agenta/ui/styles"
import {Badge} from "@agenta/ui/ui"
import {Check, Lightning, TerminalWindow} from "@phosphor-icons/react"

export interface SkillCandidate {
    key: string
    title: string
    description?: string | null
    /** The skill ships files that run as programs. */
    runsPrograms?: boolean
}

export interface UnavailableSkill {
    key: string
    title: string
    reason: string
    /** Why, in the parser's words. */
    detail?: string
}

const LAYER =
    "absolute inset-0 flex items-center justify-center transition-opacity duration-[var(--duration-fast)] motion-reduce:transition-none"

/** The row's Mark; on hover (always on touch) it shows the check box it is. */
const MarkCheck = ({checked}: {checked: boolean}) => (
    <span
        aria-hidden
        className={cn(
            "relative box-border flex size-6 shrink-0 items-center justify-center rounded-md transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none [&_svg]:size-3.5",
            checked ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
        )}
    >
        <span
            className={cn(
                LAYER,
                checked
                    ? "opacity-0"
                    : "group-hover/pick:opacity-0 group-has-[:focus-visible]/pick:opacity-0 pointer-coarse:opacity-0",
            )}
        >
            <Lightning />
        </span>
        <span
            className={cn(
                LAYER,
                checked
                    ? "opacity-100"
                    : "opacity-0 group-hover/pick:opacity-100 group-has-[:focus-visible]/pick:opacity-100 pointer-coarse:opacity-100",
            )}
        >
            {checked ? (
                <Check weight="bold" />
            ) : (
                <span className="box-border size-3.5 rounded-sm border border-solid border-border-strong bg-background" />
            )}
        </span>
    </span>
)

/** Pickable skills as two-line rows, then the ones that cannot be added. */
export function SkillCandidateList({
    candidates,
    selected,
    onToggle,
    unavailable = [],
    disabled,
}: {
    candidates: SkillCandidate[]
    selected: ReadonlySet<string>
    onToggle: (key: string) => void
    unavailable?: UnavailableSkill[]
    disabled?: boolean
}) {
    const t = useT(skillsEditorCatalog)
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                {candidates.map((candidate) => {
                    const on = selected.has(candidate.key)
                    return (
                        <label
                            key={candidate.key}
                            className={cn(
                                "group/pick relative -mx-3 box-border flex min-h-row-double cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none",
                                on ? "bg-selected" : "hover:bg-accent",
                            )}
                        >
                            <input
                                type="checkbox"
                                className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
                                checked={on}
                                disabled={disabled}
                                onChange={() => onToggle(candidate.key)}
                                aria-label={candidate.title}
                            />
                            <MarkCheck checked={on} />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-label font-medium text-foreground">
                                    {candidate.title}
                                </span>
                                {candidate.description ? (
                                    <span
                                        className="truncate text-meta text-muted-foreground"
                                        title={candidate.description}
                                    >
                                        {candidate.description}
                                    </span>
                                ) : null}
                            </span>
                            {candidate.runsPrograms ? (
                                <Badge variant="warning" className="shrink-0">
                                    <TerminalWindow aria-hidden size={12} />
                                    {t("skills.editor.runsPrograms")}
                                </Badge>
                            ) : null}
                        </label>
                    )
                })}
            </div>
            {unavailable.length ? (
                <div className="flex flex-col gap-1">
                    <span className="text-meta font-medium text-muted-foreground">
                        {t("skills.editor.notAvailable")}
                    </span>
                    {unavailable.map((item) => (
                        <div
                            key={item.key}
                            title={item.detail}
                            className="flex min-h-row-single items-center gap-2"
                        >
                            <span className="min-w-0 flex-1 truncate text-label text-muted-foreground">
                                {item.title}
                            </span>
                            <Badge className="shrink-0">{item.reason}</Badge>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
