import type {GuidePage} from "./types"

export function GuideOverview({pages}: {pages: GuidePage[]}) {
    const rules = pages.flatMap((p) => p.rules)
    const principles = [
        ["Theme variables name a job", "bg-muted text-muted-foreground, never a hex value."],
        ["Components own their size", "Pass size=\"sm\"; className is for layout only."],
        ["Tone separates areas", "A different surface, not another border."],
        ["One primary action per view", "Brand yellow only for New agent on Home."],
        ["Quiet, not loud", "Weight 600 at most, 1px lines, two text levels."],
        ["Weight shows rank, not state", "Controls stay at 500 when active, selected or focused."],
        ["Nothing is round", "Radius at most a quarter of the short side."],
        ["One icon per term", "Phosphor only; each product term has one icon."],
        ["Smaller on small screens", "Controls step down below 640px; nothing gets bigger on touch."],
        ["Data colors for data only", "data-1 to data-6 for categories and charts, never UI state."],
    ]
    return (
        <div className="flex flex-col gap-8">
            <p className="m-0 max-w-[68ch] text-body text-muted-foreground">
                This guide shows the design system with the real components. Each rule here has the ID that
                DESIGN.md, lint and reviews use, a reason, a Do and an Avoid example, and how it is checked.
                The full set of rules is in web/mobile/DESIGN.md; the values are in src/design/theme.config.ts.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                {principles.map(([title, body]) => (
                    <div key={title} className="rounded-lg bg-muted p-4">
                        <div className="text-label">{title}</div>
                        <div className="text-body text-muted-foreground">{body}</div>
                    </div>
                ))}
            </div>
            <div className="text-meta text-muted-foreground">
                {rules.length} rules with examples · {pages.filter((p) => p.specimen).length} live specimen pages
            </div>
        </div>
    )
}
