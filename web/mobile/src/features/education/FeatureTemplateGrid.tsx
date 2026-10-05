import {useMemo} from "react"

import {
    agentTemplateByKey,
    agentTemplatesAtom,
    agentTemplatesStatusAtom,
    refetchAgentTemplatesAtom,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {LoadError} from "@agenta/ui/components/presentational"
import {useAtomValue, useSetAtom} from "jotai"

import {FeatureSection} from "./FeatureSection"
import {FeatureTemplateCard} from "./FeatureTemplateCard"
import {FeatureTemplateGridSkeleton} from "./states/FeatureTemplateGridSkeleton"

/** The guide's template picks, resolved against the fetched catalog; unknown keys are skipped. */
export const FeatureTemplateGrid = ({
    templateKeys,
    browseHref,
    disabled = false,
    onSelect,
}: {
    templateKeys: readonly string[]
    browseHref: string
    /** True while a pick is being created, so a second click cannot start another. */
    disabled?: boolean
    onSelect: (template: AgentStarterTemplate) => void
}) => {
    const catalog = useAtomValue(agentTemplatesAtom)
    const status = useAtomValue(agentTemplatesStatusAtom)
    const refetch = useSetAtom(refetchAgentTemplatesAtom)
    const templates = useMemo(
        () =>
            templateKeys.flatMap((key) => {
                const template = agentTemplateByKey(catalog, key)
                return template ? [template] : []
            }),
        [catalog, templateKeys],
    )

    if (templateKeys.length === 0) return null
    if (status === "success" && templates.length === 0) return null

    return (
        <FeatureSection
            title="Start from a template"
            link={{href: browseHref, label: "View all templates"}}
        >
            {status === "pending" ? (
                <FeatureTemplateGridSkeleton count={templateKeys.length} />
            ) : status === "error" ? (
                <LoadError title="Could not load templates" onRetry={refetch} />
            ) : (
                <div className="grid gap-3 @2xl:grid-cols-3">
                    {templates.map((template) => (
                        <FeatureTemplateCard
                            key={template.key}
                            template={template}
                            disabled={disabled}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </FeatureSection>
    )
}
