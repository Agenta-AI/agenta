import {useMemo, useState} from "react"

import {
    ALL_TEMPLATES_CATEGORY,
    templateCategories,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {SectionRail, type SectionRailItem} from "@agenta/entity-ui"
import {TemplateCard} from "@agenta/home-ui"
import {Typography} from "antd"
import {ArrowRight} from "lucide-react"

import TemplateCatalogStatus from "@/oss/components/TemplateStrip/components/TemplateCatalogStatus"
import {useAgentTemplateCatalog} from "@/oss/components/TemplateStrip/hooks/useAgentTemplateCatalog"

import {TEMPLATES_SECTION} from "../../assets/constants"

interface TemplatesSectionProps {
    /** Open the setup drawer for a template. */
    onSelectTemplate: (template: AgentStarterTemplate) => void
    /** Open the full template gallery. Wired in a later phase. */
    onBrowseAll?: () => void
    /** Drop the title + Browse-all header row (the caller supplies its own, e.g. onboarding's Back). */
    hideHeader?: boolean
}

/** "Or start from a template" — category side-rail (shared SectionRail) + a narrow card grid. */
const TemplatesSection = ({onSelectTemplate, onBrowseAll, hideHeader}: TemplatesSectionProps) => {
    const [active, setActive] = useState(ALL_TEMPLATES_CATEGORY)
    const {templates, status} = useAgentTemplateCatalog()

    // Rail items: All + each present category, counted so the rail doubles as a legend.
    const railItems = useMemo<SectionRailItem[]>(() => {
        const categories = templateCategories(templates)
        return [
            {value: ALL_TEMPLATES_CATEGORY, label: "All", count: templates.length},
            ...categories.map((category) => ({
                value: category,
                label: category,
                count: templates.filter((t) => t.category === category).length,
            })),
        ]
    }, [templates])

    const filtered = useMemo(
        () =>
            active === ALL_TEMPLATES_CATEGORY
                ? templates
                : templates.filter((template) => template.category === active),
        [templates, active],
    )

    return (
        <section className="flex flex-col gap-3">
            {!hideHeader && (
                <div className="flex items-center justify-between gap-3">
                    <Typography.Title level={5} className="!m-0">
                        {TEMPLATES_SECTION.title}
                    </Typography.Title>
                    <button
                        type="button"
                        onClick={onBrowseAll}
                        className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs font-medium text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
                    >
                        {TEMPLATES_SECTION.browseAll}
                        <ArrowRight size={13} />
                    </button>
                </div>
            )}

            {status !== "success" ? (
                <TemplateCatalogStatus rows={4} className="pt-5" />
            ) : (
                <SectionRail
                    items={railItems}
                    value={active}
                    onChange={setActive}
                    railWidth="w-[132px]"
                >
                    {filtered.length > 0 ? (
                        // auto-fill fills the content column with ~320px cards (2–4 cols by width),
                        // fixed row height so switching categories never reflows card sizes.
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-x-4 gap-y-10 pt-5">
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
                </SectionRail>
            )}
        </section>
    )
}

export default TemplatesSection
