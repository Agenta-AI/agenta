import {designRules} from "./ruleIndex"
import type {GuidePage} from "./types"

export function GuideOverview({pages}: {pages: GuidePage[]}) {
    const rules = pages.flatMap((p) => p.rules)
    return (
        <div className="flex flex-col gap-8">
            <p className="m-0 max-w-[68ch] text-body text-muted-foreground">
                This guide shows each rule with the real components: its ID, its reason, a Do and an Avoid
                example, and how it is checked. The rules come from src/design/rules.json and the values
                from src/design/theme.config.ts. The principles, the layout and the patterns are in
                web/mobile/DESIGN.md.
            </p>
            <div className="text-meta text-muted-foreground">
                {rules.length} of {designRules.length} rules with examples · {pages.filter((p) => p.specimen).length} live specimen pages
            </div>
        </div>
    )
}
