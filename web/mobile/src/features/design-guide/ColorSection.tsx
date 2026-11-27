import {colors} from "@agenta/ui/design/theme"

import {SectionTitle} from "./SectionTitle"

const statuses = ["destructive", "success", "warning", "info"]

export function ColorSection() {
    return (
        <section>
            <SectionTitle
                title="Color"
                description="Every theme color and its job: the UI colors first, then the data and media colors."
            />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-3">
                {colors.map((c) => (
                    <div key={c.name} className="flex min-w-0 items-start gap-3">
                        <span
                            className="mt-0.5 size-8 shrink-0 rounded-[var(--radius-md)] shadow-[inset_0_0_0_1px_var(--border-muted)]"
                            style={{background: `var(--${c.name})`}}
                        />
                        <div className="min-w-0">
                            <div className="truncate font-mono text-code-sm">{c.name}</div>
                            <div className="text-meta text-muted-foreground">{c.usage}</div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
                {statuses.map((s) => (
                    <span
                        key={s}
                        className="inline-flex h-5 items-center rounded-[var(--radius-sm)] px-1.5 text-caption"
                        style={{
                            color: `var(--${s})`,
                            background: `color-mix(in srgb, var(--${s}) 10%, transparent)`,
                        }}
                    >
                        {s} / 10
                    </span>
                ))}
            </div>
        </section>
    )
}
