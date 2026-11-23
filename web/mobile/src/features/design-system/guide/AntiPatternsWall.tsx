import type {GuidePage, GuideRule} from "./types"

export function AntiPatternsWall({
    pages,
    extra = [],
    onOpen,
}: {
    pages: GuidePage[]
    /** Anti-patterns that are not rules: they show only here. */
    extra?: GuideRule[]
    onOpen: (pageId: string, ruleId: string) => void
}) {
    const items = [
        ...extra.map((r) => ({page: "anti-patterns", rule: r})),
        ...pages.flatMap((p) => p.rules.map((r) => ({page: p.id, rule: r}))),
    ]
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map(({page, rule}) => (
                <button
                    key={rule.id}
                    type="button"
                    onClick={() => onOpen(page, rule.id)}
                    className="focus-ring flex flex-col gap-2 rounded-lg border-0 bg-transparent p-0 text-left"
                >
                    <div className="pointer-events-none flex min-h-36 w-full items-center justify-center overflow-hidden rounded-lg bg-muted p-4 shadow-[inset_0_0_0_1px_var(--border-muted)]">
                        {rule.avoid.example}
                    </div>
                    <span className="text-label">
                        <span className="text-destructive">{rule.id}</span> · {rule.title}
                    </span>
                </button>
            ))}
        </div>
    )
}
