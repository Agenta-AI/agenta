import {cn} from "@agenta/ui/styles"
import {Check, Compass} from "@phosphor-icons/react"

export interface SkillCandidate {
    key: string
    title: string
    description?: string | null
}

export interface UnavailableSkill {
    key: string
    title: string
    reason: string
}

/** Pickable skills as toggle rows, then the ones that cannot be added. */
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
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                {candidates.map((candidate) => {
                    const on = selected.has(candidate.key)
                    return (
                        <label
                            key={candidate.key}
                            className={cn(
                                "relative box-border flex min-h-[72px] cursor-pointer items-center gap-3 rounded-xl border border-solid bg-card px-4 py-3 transition-colors hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
                                on ? "border-foreground" : "border-border",
                            )}
                        >
                            <input
                                type="checkbox"
                                className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
                                checked={on}
                                disabled={disabled}
                                onChange={() => onToggle(candidate.key)}
                            />
                            <span
                                aria-hidden
                                className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-solid border-border bg-muted text-muted-foreground"
                            >
                                <Compass size={16} />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-sm font-medium">
                                    {candidate.title}
                                </span>
                                {candidate.description ? (
                                    <span className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">
                                        {candidate.description}
                                    </span>
                                ) : null}
                            </span>
                            <span
                                aria-hidden
                                className={cn(
                                    "box-border flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-solid transition-colors",
                                    on
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-input text-transparent",
                                )}
                            >
                                <Check size={12} weight="bold" className={on ? "animate-skill-pop" : undefined} />
                            </span>
                        </label>
                    )
                })}
            </div>
            {unavailable.length ? (
                <div className="flex flex-col gap-1 px-1 pt-1">
                    <span className="text-xs font-medium text-muted-foreground">Not available</span>
                    {unavailable.map((item) => (
                        <div
                            key={item.key}
                            className="flex items-baseline gap-2 py-1 text-[13px] leading-[18px] text-muted-foreground"
                        >
                            <span className="min-w-0 truncate text-foreground">{item.title}</span>
                            <span className="flex-1" />
                            <span className="shrink-0 text-right">{item.reason}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
