import {IconTile} from "@agenta/ui/ui"

import rulesJson from "@agenta/ui/design/rules.json"

import {SectionTitle} from "./SectionTitle"
import {termIcons} from "./termIcons"

export function IconTermsSection() {
    return (
        <section>
            <SectionTitle
                title="Icon per term"
                description="A product term or a fixed action always has this icon. The list comes from rules.json."
            />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 gap-y-3">
                {rulesJson.terms.map((t) => {
                    const TermIcon = termIcons[t.component]
                    return (
                        <div key={t.term} className="flex min-w-0 items-start gap-3">
                            <IconTile size={32}>
                                {TermIcon ? <TermIcon /> : t.term.charAt(0)}
                            </IconTile>
                            <div className="min-w-0">
                                <div className="text-label">{t.term}</div>
                                <div className="font-mono text-code-sm text-muted-foreground">
                                    {TermIcon ? t.icon : "a Mark with the letter"}
                                </div>
                                {t.note ? (
                                    <div className="text-meta text-muted-foreground">{t.note}</div>
                                ) : null}
                            </div>
                        </div>
                    )
                })}
            </div>
        </section>
    )
}
