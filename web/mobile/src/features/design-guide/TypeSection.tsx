import {textStyles} from "@agenta/ui/design/theme"

import {SectionTitle} from "./SectionTitle"

export function TypeSection() {
    return (
        <section>
            <SectionTitle title="Type" description="The interface styles and the code styles. Weight 600 is the heaviest, and weight never changes with state." />
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
                            className="min-w-0"
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
