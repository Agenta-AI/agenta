import {useEffect, useState} from "react"

import {ArrowLeft, ArrowRight} from "@phosphor-icons/react"
import {Typography} from "antd"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {captureFirstAgentIntent} from "../assets/onboardingAnalytics"
import {AGENT_TEMPLATES, templateBuilderMessage, type AgentTemplate} from "../assets/templates"

import {useOnboardingContext} from "./OnboardingContext"

/**
 * The onboarding left panel — the "OPTIONAL · START FROM A TEMPLATE" list, rendered in the config
 * panel slot (via MainLayout's `renderConfigOverride`) while the agent is still ephemeral. Picking a
 * template commits THIS mount's ephemeral in place (no redirect) and seeds the builder with the
 * template's instruction. Once the agent is real, MainLayout renders the normal config forms instead.
 *
 * Legacy (non-strip) onboarding only — under TEMPLATE_STRIP_MODE, `useAgentOnboarding` never
 * overrides the config slot, so the ephemeral's real config panel renders here instead.
 */
const OnboardingConfigPanel = () => {
    const {commit, committing, browseAll, setBrowseAll} = useOnboardingContext()
    const posthog = usePostHogAg()
    // Fade IN on mount, and OUT while committing (so the templates are gone before MainLayout swaps in
    // the real config panel) — softens both ends of the left-panel handoff instead of hard cuts.
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    const selectTemplate = (template: AgentTemplate) => {
        captureFirstAgentIntent(posthog, {
            source: "template",
            properties: {
                template: template.name,
                templateId: template.key,
                templateCategory: template.category,
                mode: "playground_onboarding",
            },
            intentValue: template.category || template.name,
        })
        commit(templateBuilderMessage(template), template.name)
    }

    return (
        <div
            className={`flex h-full flex-col gap-2 p-4 motion-safe:transition-opacity motion-safe:duration-300 ${
                mounted && !committing ? "opacity-100" : "opacity-0"
            }`}
        >
            <Typography.Text className="!px-1 !text-[11px] !font-semibold !uppercase !tracking-wide !text-[var(--ag-colorTextTertiary)]">
                Optional · Start from a template
            </Typography.Text>

            <div className="flex flex-col gap-0.5">
                {AGENT_TEMPLATES.map((template) => (
                    <button
                        key={template.key}
                        type="button"
                        disabled={committing}
                        onClick={() => selectTemplate(template)}
                        className="box-border flex w-full cursor-pointer items-start gap-2.5 rounded-lg border-0 bg-transparent px-2 py-2 text-left transition-colors hover:bg-[var(--ag-colorFillTertiary)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--ag-colorFillSecondary)] text-[11px] font-semibold text-[var(--ag-colorTextSecondary)]">
                            {template.initials}
                        </span>
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate text-xs font-medium text-[var(--ag-colorTextSecondary)]">
                                {template.name}
                            </span>
                            <span className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                                {template.description}
                            </span>
                        </span>
                    </button>
                ))}
            </div>

            {/* Toggles the full in-place gallery in the right panel (no navigation away). */}
            <button
                type="button"
                onClick={() => {
                    // Only the transition INTO the gallery is a "browsing away" signal, not the "back"
                    // click (same button, opposite label) — avoid double-firing on the round trip.
                    if (!browseAll) {
                        captureFirstAgentIntent(posthog, {source: "browse_templates"})
                    }
                    setBrowseAll(!browseAll)
                }}
                className="mt-1 inline-flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent px-2 py-1 text-xs text-[var(--ag-colorPrimary)] hover:underline"
            >
                {browseAll ? (
                    <>
                        <ArrowLeft size={13} />
                        Back to composer
                    </>
                ) : (
                    <>
                        Browse all templates
                        <ArrowRight size={13} />
                    </>
                )}
            </button>
        </div>
    )
}

export default OnboardingConfigPanel
