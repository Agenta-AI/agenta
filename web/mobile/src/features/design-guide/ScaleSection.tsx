import {radius, shadows, sizes, spacing} from "@agenta/ui/design/theme"

import {SectionTitle} from "./SectionTitle"

const controls = sizes.filter((s) => /^control-(xs|sm|md|lg)$/.test(s.name))

export function ScaleSection() {
    return (
        <section className="flex flex-col gap-10">
            <div>
                <SectionTitle title="Spacing" description="The Tailwind scale: spacing-4 is 16px, the same as p-4." />
                <div className="flex flex-col gap-1.5">
                    {spacing.map((s) => (
                        <div key={s.name} className="flex items-center gap-3 font-mono text-xs">
                            <span className="w-24 shrink-0">{s.name}</span>
                            <span className="h-3 rounded-[1px] bg-foreground" style={{width: s.value}} />
                            <span className="text-muted-foreground">{s.value}</span>
                        </div>
                    ))}
                </div>
            </div>
            <div>
                <SectionTitle title="Controls" description="Below 640px control-md is 28 and control-lg is 32. Nothing is bigger on touch or on a compact window." />
                <div className="flex flex-wrap items-end gap-2">
                    {controls.map((s) => (
                        <span
                            key={s.name}
                            className="inline-flex items-center rounded-[var(--radius-md)] bg-secondary px-3 text-xs font-medium"
                            style={{height: `var(--${s.name})`}}
                        >
                            {s.name}
                        </span>
                    ))}
                </div>
            </div>
            <div>
                <SectionTitle title="Radius" description="Controls and containers are square: a radius is at most a quarter of the short side. Only things round by nature (status dots, the switch, the radio, the slider handle) use radius-round." />
                <div className="flex flex-wrap gap-4">
                    {radius.map((r) => (
                        <div key={r.name} className="flex flex-col items-center gap-1 font-mono text-xs">
                            <span className="size-12 bg-[var(--selected)]" style={{borderRadius: r.value}} />
                            {r.name} · {r.value}
                        </div>
                    ))}
                </div>
            </div>
            <div>
                <SectionTitle title="Elevation" description="Only things that float get a shadow. Hover never adds one." />
                <div className="flex flex-wrap gap-6 rounded-[var(--radius-lg)] bg-muted p-6">
                    {shadows.map((s) => (
                        <div
                            key={s.name}
                            className="flex h-20 w-40 items-center justify-center rounded-[var(--radius-lg)] bg-popover font-mono text-xs"
                            style={{boxShadow: `var(--${s.name})`}}
                        >
                            {s.name}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
