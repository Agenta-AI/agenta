import type {GuidePage} from "./types"

export function PropsTable({rows}: {rows: NonNullable<GuidePage["api"]>}) {
    return (
        <div className="overflow-x-auto rounded-lg shadow-[inset_0_0_0_1px_var(--border-muted)]">
            <table className="w-full border-collapse text-label">
                <thead>
                    <tr className="text-left text-meta text-muted-foreground">
                        <th className="h-8 px-3 font-medium">Prop</th>
                        <th className="px-3 font-medium">Values</th>
                        <th className="px-3 font-medium">Note</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.prop} className="border-t border-border-muted align-top">
                            <td className="px-3 py-2 text-code-sm">{r.prop}</td>
                            <td className="px-3 py-2 text-code-sm">{r.values}</td>
                            <td className="px-3 py-2 font-normal text-muted-foreground">{r.note}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
