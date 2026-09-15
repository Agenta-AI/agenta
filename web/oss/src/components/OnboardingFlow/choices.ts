import {AGENT_TEMPLATES, templateBuilderMessage} from "@agenta/entities/workflow"

export const ONBOARDING_EXPERIMENT = "onboarding-first-agent-v1"
export type OnboardingVariant = "control" | "task-first"
export const roles = [
    "Engineering",
    "Product",
    "Sales",
    "Marketing",
    "Customer support",
    "Operations",
    "Data & analytics",
    "Founder / Executive",
    "Something else",
]
export const sources = [
    "GitHub",
    "Online search",
    "AI assistant",
    "Social media",
    "Friend or colleague",
    "Blog or publication",
    "Reddit",
    "Other",
]
const categories: Record<string, string> = {
    "Customer support": "Support",
    Operations: "Ops",
    Marketing: "Knowledge",
    Product: "Knowledge",
    "Founder / Executive": "Ops",
    "Data & analytics": "Ops",
}
export function suggestionsForRole(role: string) {
    return AGENT_TEMPLATES.filter(
        (template) => template.category === (categories[role] ?? role),
    ).slice(0, 5)
}
export function firstAgentInput(
    variant: OnboardingVariant,
    name: string,
    task: string,
    templateKey: string | null,
) {
    const template = AGENT_TEMPLATES.find((item) => item.key === templateKey)
    const seedMessage =
        task.trim() ||
        (template
            ? templateBuilderMessage(template)
            : variant === "control" && name.trim()
              ? `Set up ${name.trim()}: help me define what this agent should do.`
              : "")
    const agentName = variant === "control" ? name.trim() : (template?.name ?? "My first agent")
    return agentName && seedMessage ? {name: agentName, seedMessage} : null
}
