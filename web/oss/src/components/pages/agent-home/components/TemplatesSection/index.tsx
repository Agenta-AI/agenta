import {useMemo, useState} from "react"

import {Select, Typography} from "antd"
import {ArrowRight} from "lucide-react"

import {TEMPLATES_SECTION} from "../../assets/constants"
import {
    AGENT_TEMPLATES,
    ALL_TEMPLATES_CATEGORY,
    templateCategories,
    type AgentTemplate,
} from "../../assets/templates"

import TemplateCard from "./TemplateCard"

interface TemplatesSectionProps {
    /** Open the setup drawer for a template. */
    onSelectTemplate: (template: AgentTemplate) => void
    /** Open the full template gallery. Wired in a later phase. */
    onBrowseAll?: () => void
    /** Drop the title + Browse-all header row (the caller supplies its own, e.g. onboarding's Back). */
    hideHeader?: boolean
}

/** "Or start from a template" — category filter dropdown (top right) + a full-width card grid. */
const TemplatesSection = ({onSelectTemplate, onBrowseAll, hideHeader}: TemplatesSectionProps) => {
    const [active, setActive] = useState(ALL_TEMPLATES_CATEGORY)

    // Dropdown options: All + each present category, counted so the label doubles as a legend.
    const categoryOptions = useMemo(() => {
        const categories = templateCategories()
        return [
            {value: ALL_TEMPLATES_CATEGORY, label: `All (${AGENT_TEMPLATES.length})`},
            ...categories.map((category) => ({
                value: category,
                label: `${category} (${AGENT_TEMPLATES.filter((t) => t.category === category).length})`,
            })),
        ]
    }, [])

    const filtered = useMemo(
        () =>
            active === ALL_TEMPLATES_CATEGORY
                ? AGENT_TEMPLATES
                : AGENT_TEMPLATES.filter((template) => template.category === active),
        [active],
    )

    const categoryFilter = (
        <Select
            value={active}
            onChange={setActive}
            options={categoryOptions}
            size="small"
            variant="filled"
            className="w-[150px]"
            popupMatchSelectWidth={false}
        />
    )

    return (
        <section className="flex flex-col gap-3">
            {!hideHeader ? (
                <div className="flex items-center justify-between gap-3">
                    <Typography.Title level={5} className="!m-0">
                        {TEMPLATES_SECTION.title}
                    </Typography.Title>
                    <div className="flex items-center gap-3">
                        {categoryFilter}
                        <button
                            type="button"
                            onClick={onBrowseAll}
                            className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs font-medium text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
                        >
                            {TEMPLATES_SECTION.browseAll}
                            <ArrowRight size={13} />
                        </button>
                    </div>
                </div>
            ) : (
                // No header row here (caller supplies its own) — still surface the filter, right-aligned.
                <div className="flex items-center justify-end">{categoryFilter}</div>
            )}

            {filtered.length > 0 ? (
                // auto-fill fills the row with ~320px cards (2–4 cols by width), fixed row height so
                // switching categories never reflows card sizes.
                <div className="grid auto-rows-[132px] grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
                    {filtered.map((template) => (
                        <TemplateCard
                            key={template.key}
                            template={template}
                            onSelect={onSelectTemplate}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--ag-colorBorder)] px-4 py-6 text-xs text-[var(--ag-colorTextSecondary)]">
                    <span>No templates in {active}.</span>
                    <button
                        type="button"
                        onClick={() => setActive(ALL_TEMPLATES_CATEGORY)}
                        className="border-0 bg-transparent p-0 font-medium text-[var(--ag-colorPrimary)]"
                    >
                        Show all
                    </button>
                </div>
            )}
        </section>
    )
}

export default TemplatesSection
