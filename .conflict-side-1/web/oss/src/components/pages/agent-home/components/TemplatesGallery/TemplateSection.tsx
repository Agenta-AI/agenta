import type {AgentTemplate} from "../../assets/templates"
import TemplateCard from "../TemplatesSection/TemplateCard"

interface TemplateSectionProps {
    category: string
    templates: AgentTemplate[]
    onSelectTemplate: (template: AgentTemplate) => void
}

/** One category block in the gallery: uppercase header + per-section count, then a 3-col card grid. */
const TemplateSection = ({category, templates, onSelectTemplate}: TemplateSectionProps) => {
    if (templates.length === 0) return null

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-[var(--ag-colorBorderSecondary)] pb-2">
                <span className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--ag-colorTextSecondary)]">
                    {category}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--ag-colorTextTertiary)]">
                    {templates.length} {templates.length === 1 ? "template" : "templates"}
                </span>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {templates.map((template) => (
                    <TemplateCard
                        key={template.key}
                        template={template}
                        onSelect={onSelectTemplate}
                    />
                ))}
            </div>
        </section>
    )
}

export default TemplateSection
