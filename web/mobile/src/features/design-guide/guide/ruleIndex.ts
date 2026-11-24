import rulesJson from "@agenta/ui/design/rules.json"

import type {GuideRule, RuleExample} from "./types"

interface DesignRule {
    id: string
    rule: string
    why: string
    avoid: string
    do: string
    checkedBy: GuideRule["checkedBy"]
}

/** Every rule in rules.json, in order, with the title of its group. */
export const designRules: (DesignRule & {group: string})[] = rulesJson.groups.flatMap((g) =>
    g.rules.map((r) => ({...(r as DesignRule), group: g.title})),
)

const byId = new Map(designRules.map((r) => [r.id, r]))

/** Joins an example to its rule. An example without a rule is a stale ID. */
export function resolveRule(example: RuleExample): GuideRule {
    const rule = byId.get(example.id)
    if (!rule) throw new Error(`${example.id} has an example in the guide but no rule in rules.json`)
    return {...example, title: rule.rule, why: rule.why, avoidText: rule.avoid, doText: rule.do, group: rule.group, checkedBy: rule.checkedBy}
}
