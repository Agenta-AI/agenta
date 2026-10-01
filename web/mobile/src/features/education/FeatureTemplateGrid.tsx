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

import {FeatureTemplateCard} from "./FeatureTemplateCard"
import {FeatureTemplateGridSkeleton} from "./states/FeatureTemplateGridSkeleton"

/** The guide's template picks, resolved against the fetched catalog; unknown keys are skipped. */
export const FeatureTemplateGrid = ({
    templateKeys,
    onSelect,
}: {
    templateKeys: readonly string[]
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
        <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="m-0 text-[14px] font-semibold text-foreground">
                    Start from a template
                </h2>
                <span className="text-[12.5px] text-colorTextTertiary @max-xl:hidden">
                    Opens in chat, ready to edit
                </span>
            </div>
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
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </section>
    )
}
