import type {GuidePage} from "./types"

interface GuideNavProps {
    pages: GuidePage[]
    current: string
    onSelect: (id: string) => void
}

export function GuideNav({pages, current, onSelect}: GuideNavProps) {
    const groups = [...new Set(pages.map((p) => p.group))]
    return (
        <nav aria-label="Design guide" className="flex flex-col gap-4">
            {groups.map((g) => (
                <div key={g} className="flex flex-col gap-0.5">
                    <div className="px-2 pb-1 text-meta text-muted-foreground">{g}</div>
                    {pages
                        .filter((p) => p.group === g)
                        .map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                aria-current={p.id === current ? "page" : undefined}
                                onClick={() => onSelect(p.id)}
                                className="focus-ring flex h-7 items-center justify-between gap-2 rounded-md px-2 text-left text-label text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-selected aria-[current=page]:text-foreground"
                            >
                                <span className="min-w-0 truncate">{p.title}</span>
                                {p.rules.length ? <span className="shrink-0 text-meta">{p.rules.length}</span> : null}
                            </button>
                        ))}
                </div>
            ))}
        </nav>
    )
}
