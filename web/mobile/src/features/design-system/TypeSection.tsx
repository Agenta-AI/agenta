import {textStyles} from "@/design/theme.config"

import {SectionTitle} from "./SectionTitle"

export function TypeSection() {
    return (
        <section>
            <SectionTitle title="Type" description="Ten interface styles and two for code. Weight 600 is the heaviest, and weight never changes with state." />
            <div className="flex flex-col">
                {textStyles.map((t) => (
                    <div key={t.name} className="grid grid-cols-1 gap-1 border-t border-border-muted py-3 sm:grid-cols-[180px_1fr]">
                        <div className="font-mono text-code-sm">
                            {t.name}
                            <div className="text-muted-foreground">
                                {t.fontSize} / {t.lineHeight} · {t.fontWeight}
                            </div>
                        </div>
                        <div
                            className="min-w-0 truncate"
                            style={{
                                fontFamily: `var(--font-${t.family})`,
                                fontSize: t.fontSize,
                                lineHeight: t.lineHeight,
                                fontWeight: t.fontWeight,
                                letterSpacing: t.letterSpacing,
                            }}
                        >
                            {t.usage}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    )
}
