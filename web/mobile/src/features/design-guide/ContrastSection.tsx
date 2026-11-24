import {contrastPairs, contrastRatio, resolveColor} from "@agenta/ui/design/contrast"

import {SectionTitle} from "./SectionTitle"

export function ContrastSection({mode}: {mode: "light" | "dark"}) {
    return (
        <section>
            <SectionTitle
                title="Contrast"
                description="Every text and surface pair the system promises, in the current theme. The unit test checks both themes."
            />
            <div className="overflow-x-auto rounded-[var(--radius-lg)] shadow-[inset_0_0_0_1px_var(--border-muted)]">
                <table className="w-full text-label">
                    <thead>
                        <tr className="text-left text-meta text-muted-foreground">
                            <th className="h-8 px-3 font-medium">Sample</th>
                            <th className="px-3 font-medium">Text</th>
                            <th className="px-3 font-medium">On</th>
                            <th className="px-3 text-right font-medium">Ratio</th>
                        </tr>
                    </thead>
                    <tbody>
                        {contrastPairs.map(([fg, bg, min]) => {
                            const ratio = contrastRatio(resolveColor(fg, mode), resolveColor(bg, mode))
                            return (
                                <tr key={`${fg}/${bg}`} className="border-t border-border-muted">
                                    <td className="px-3 py-1.5">
                                        <span
                                            className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium"
                                            style={{color: `var(--${fg})`, background: `var(--${bg})`}}
                                        >
                                            Aa
                                        </span>
                                    </td>
                                    <td className="px-3 font-mono text-xs">{fg}</td>
                                    <td className="px-3 font-mono text-xs">{bg}</td>
                                    <td
                                        className={`px-3 text-right font-mono text-xs tabular-nums ${ratio >= min ? "" : "text-destructive"}`}
                                    >
                                        {ratio.toFixed(2)} / {min}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    )
}
