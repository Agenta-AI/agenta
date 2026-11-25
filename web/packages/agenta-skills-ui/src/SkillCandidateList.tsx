import {useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {cn} from "@agenta/ui/styles"
import {Check, Compass, Warning} from "@phosphor-icons/react"

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

/** The row's skill Mark (32px, a two-line row); a check on fine-pointer hover, keyboard focus or when picked. */
const MarkCheck = ({checked}: {checked: boolean}) => (
    <span
        aria-hidden
        className={cn(
            "relative box-border flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none [&_svg]:size-4",
            checked ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
        )}
    >
        <span
            className={cn(
                LAYER,
                checked
                    ? "opacity-0"
                    : "pointer-fine:group-hover/pick:opacity-0 group-has-[:focus-visible]/pick:opacity-0",
            )}
        >
            <Compass />
        </span>
        <span
            className={cn(
                LAYER,
                checked
                    ? "opacity-100"
                    : "opacity-0 pointer-fine:group-hover/pick:opacity-100 group-has-[:focus-visible]/pick:opacity-100",
            )}
        >
            <Check />
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
            {candidates.length ? (
                <div className="flex flex-col gap-2">
                    {candidates.map((candidate) => {
                        const on = selected.has(candidate.key)
                        return (
                            <label
                                key={candidate.key}
                                className={cn(
                                    "group/pick relative -mx-3 box-border flex min-h-row-double items-center gap-3 rounded-md px-3 py-1.5 transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none",
                                    // focus-ring-inset (focus.css), shown when the hidden box has keyboard focus.
                                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-[var(--ring)]",
                                    on && "bg-selected",
                                    disabled ? "cursor-default opacity-60" : "cursor-pointer",
                                    !disabled && !on && "hover:bg-accent",
                                )}
                            >
                                <input
                                    type="checkbox"
                                    className={cn(
                                        "absolute inset-0 m-0 size-full opacity-0",
                                        disabled ? "cursor-default" : "cursor-pointer",
                                    )}
                                    checked={on}
                                    disabled={disabled}
                                    onChange={() => onToggle(candidate.key)}
                                    aria-label={candidate.title}
                                />
                                <MarkCheck checked={on} />
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="flex min-w-0 items-center gap-2">
                                        <span className="truncate text-label font-medium text-foreground">
                                            {candidate.title}
                                        </span>
                                        {candidate.runsPrograms ? (
                                            <span className="flex shrink-0 items-center gap-1 text-meta text-warning">
                                                <Warning aria-hidden size={12} />
                                                {t("skills.editor.runsPrograms")}
                                            </span>
                                        ) : null}
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
                            </label>
                        )
                    })}
                </div>
            ) : null}
            {unavailable.length ? (
                <div className="flex flex-col gap-1">
                    <span className="text-label text-muted-foreground">
                        {t("skills.editor.notAvailable")}
                    </span>
                    {unavailable.map((item) => (
                        <div key={item.key} className="flex min-h-row-single items-center gap-2">
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-label text-foreground">
                                    {item.title}
                                </span>
                                {item.detail ? (
                                    <span className="text-meta text-muted-foreground">
                                        {item.detail}
                                    </span>
                                ) : null}
                            </span>
                            <span className="shrink-0 text-label text-muted-foreground">
                                {item.reason}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
