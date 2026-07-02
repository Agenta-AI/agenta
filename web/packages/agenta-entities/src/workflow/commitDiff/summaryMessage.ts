/**
 * Build a human commit message from classified sections, used to pre-fill the
 * (editable) commit-message field. E.g.
 *   "Added 24 tools, edited the instructions, and changed the model to claude-opus-4-8."
 */
import type {ChangeSection} from "./types"

function plural(word: string, n: number): string {
    return n === 1 ? word : `${word}s`
}

function joinClauses(parts: string[]): string {
    if (parts.length <= 1) return parts.join("")
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`
}

function toolsPhrase(section: ChangeSection): string {
    const items = section.items ?? []
    const counts = {added: 0, edited: 0, removed: 0}
    for (const it of items) {
        if (it.kind === "added") counts.added++
        else if (it.kind === "removed") counts.removed++
        else counts.edited++
    }
    const sub: string[] = []
    if (counts.added) sub.push(`added ${counts.added} ${plural("tool", counts.added)}`)
    if (counts.edited) sub.push(`edited ${counts.edited} ${plural("tool", counts.edited)}`)
    if (counts.removed) sub.push(`removed ${counts.removed} ${plural("tool", counts.removed)}`)
    return sub.join(", ")
}

export function buildCommitSummaryMessage(sections: ChangeSection[]): string {
    const phrases: string[] = []
    for (const section of sections) {
        switch (section.id) {
            case "tools":
                phrases.push(toolsPhrase(section))
                break
            case "instructions":
                phrases.push("edited the instructions")
                break
            case "model": {
                const to = section.scalarChanges?.find((c) => c.key === "model")?.after
                phrases.push(to ? `changed the model to ${to}` : "updated the model & harness")
                break
            }
            case "mcps":
                phrases.push("updated the MCP servers")
                break
            case "skills":
                phrases.push("updated the skills")
                break
            case "params": {
                const n = section.totalCount
                phrases.push(`changed ${n} advanced ${plural("setting", n)}`)
                break
            }
        }
    }
    const filtered = phrases.filter(Boolean)
    if (!filtered.length) return ""
    const sentence = joinClauses(filtered)
    return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}
