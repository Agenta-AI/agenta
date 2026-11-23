import {Badge} from "@agenta/ui/ui"

import {CodeSnippet} from "./CodeSnippet"
import {DoAvoid} from "./DoAvoid"
import {InlineCode} from "./InlineCode"
import type {GuideRule} from "./types"

export function RuleBlock({rule}: {rule: GuideRule}) {
    return (
        <section id={rule.id} className="scroll-mt-6 border-t border-border-muted pt-8">
            <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-title">
                    <InlineCode text={rule.title} />
                </h3>
                <Badge>{rule.id}</Badge>
            </div>
            <p className="mb-4 mt-0 max-w-[68ch] text-body text-muted-foreground">
                <InlineCode text={rule.why} />
            </p>
            <div className="grid gap-4 md:grid-cols-2">
                <DoAvoid kind="do" {...rule.do} />
                <DoAvoid kind="avoid" {...rule.avoid} />
            </div>
            {rule.do.code ? (
                <div className="mt-3">
                    <CodeSnippet code={rule.do.code} />
                </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1">
                {rule.checkedBy.map((c) => (
                    <Badge key={c} variant={c === "review" ? "default" : "info"}>
                        Checked by {c}
                    </Badge>
                ))}
            </div>
        </section>
    )
}
