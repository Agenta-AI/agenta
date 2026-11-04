import {Button} from "@agenta/ui/ui"

export interface ConfigNavItem {
    id: string
    label: string
    count: number
}

/** Links to the sections of the tab, with their counts. Desktop only: a phone scrolls. */
export const ConfigSectionNav = ({items}: {items: readonly ConfigNavItem[]}) => (
    <nav
        aria-label="Configuration sections"
        className="box-border hidden flex-col gap-1 rounded-lg border border-solid border-border bg-card p-2 lg:flex"
    >
        {items.map((item) => (
            <Button
                key={item.id}
                variant="ghost"
                size="sm"
                className="justify-between"
                onClick={() =>
                    document.getElementById(item.id)?.scrollIntoView({behavior: "smooth"})
                }
            >
                {item.label}
                <span className="text-muted-foreground">{item.count}</span>
            </Button>
        ))}
    </nav>
)
