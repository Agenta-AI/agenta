import rulesJson from "@/design/rules.json"

import type {GuideRule, RuleExample} from "./types"

interface DesignRule {
    id: string
    rule: string
    why: string
    checkedBy: GuideRule["checkedBy"]
}

/** Every rule in DESIGN.md, in table order, with the title of its table. */
export const designRules: (DesignRule & {group: string})[] = rulesJson.groups.flatMap((g) =>
    g.rules.map((r) => ({...(r as DesignRule), group: g.title})),
)

export const designPrinciples: {title: string; body: string}[] = rulesJson.principles

const byId = new Map(designRules.map((r) => [r.id, r]))

/** Joins an example to its DESIGN.md row. An example without a row is a stale ID. */
export function resolveRule(example: RuleExample): GuideRule {
    const rule = byId.get(example.id)
    if (!rule) throw new Error(`${example.id} has an example in the guide but no row in DESIGN.md`)
    return {...example, title: rule.rule, why: rule.why, group: rule.group, checkedBy: rule.checkedBy}
}
