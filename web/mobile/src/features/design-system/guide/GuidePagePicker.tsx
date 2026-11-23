import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"

import type {GuidePage} from "./types"

export function GuidePagePicker({pages, current, onSelect}: {pages: GuidePage[]; current: string; onSelect: (id: string) => void}) {
    return (
        <Select value={current} onValueChange={onSelect}>
            <SelectTrigger aria-label="Guide page" className="w-full">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {pages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                        {p.group} · {p.title}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
