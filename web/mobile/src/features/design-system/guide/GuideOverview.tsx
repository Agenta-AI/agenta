import {InlineCode} from "./InlineCode"
import {designPrinciples, designRules} from "./ruleIndex"
import type {GuidePage} from "./types"

export function GuideOverview({pages}: {pages: GuidePage[]}) {
    const rules = pages.flatMap((p) => p.rules)
    return (
        <div className="flex flex-col gap-8">
            <p className="m-0 max-w-[68ch] text-body text-muted-foreground">
                This guide shows each rule of web/mobile/DESIGN.md with the real components: its ID, its
                reason, a Do and an Avoid example, and how it is checked. The words come from DESIGN.md;
                the values come from src/design/theme.config.ts.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                {designPrinciples.map(({title, body}) => (
                    <div key={title} className="rounded-lg bg-muted p-4">
                        <div className="text-label">{title}</div>
                        <div className="text-body text-muted-foreground">
                            <InlineCode text={body} />
                        </div>
                    </div>
                ))}
            </div>
            <div className="text-meta text-muted-foreground">
                {rules.length} of {designRules.length} rules with examples · {pages.filter((p) => p.specimen).length} live specimen pages
            </div>
        </div>
    )
}
