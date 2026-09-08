import type {AutomationTemplate} from "./templates"

/**
 * One example on the automations empty state.
 *
 * A button, not a link card: picking one seeds a draft rather than navigating to something that
 * already exists. Left-aligned because the body is a sentence, and centred sentences are the
 * thing that makes an empty state read as an advert.
 */
export const AutomationTemplateCard = ({
    template,
    onSelect,
}: {
    template: AutomationTemplate
    onSelect: (template: AutomationTemplate) => void
}) => {
    const Icon = template.icon

    return (
        <button
            type="button"
            onClick={() => onSelect(template)}
            className="flex cursor-pointer flex-col items-start gap-1.5 rounded-[10px] border border-solid border-border bg-background p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
            <Icon size={16} className="text-primary" aria-hidden />
            <span className="text-[14px] font-medium text-foreground">{template.title}</span>
            <span className="text-[13px] leading-[1.45] text-muted-foreground">
                {template.body}
            </span>
        </button>
    )
}
