import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {captureFirstAgentIntent} from "../assets/onboardingAnalytics"
import {templateBuilderMessage, type AgentTemplate} from "../assets/templates"
import TemplatesSection from "../components/TemplatesSection"

import {useOnboardingContext} from "./OnboardingContext"
import Reveal from "./Reveal"

/**
 * "Browse all templates" — the full template gallery rendered IN PLACE of the onboarding hero (right
 * panel), instead of navigating away to the standalone gallery page. Reuses the same `TemplatesSection`
 * (category rail + card grid) as Home; picking a card commits the ephemeral in place (same path as the
 * left quick-pick list), so selection never diverges into the redirect-create flow.
 */
const OnboardingBrowseTemplates = () => {
    const {commit, setBrowseAll} = useOnboardingContext()
    const posthog = usePostHogAg()

    const selectTemplate = (template: AgentTemplate) => {
        captureFirstAgentIntent(posthog, {
            source: "template",
            properties: {
                template: template.name,
                templateId: template.key,
                templateCategory: template.category,
                mode: "playground_onboarding_gallery",
            },
            intentValue: template.category || template.name,
        })
        commit(templateBuilderMessage(template), template.name)
    }

    return (
        <Reveal className="mx-auto flex w-full max-w-[880px] flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <Typography.Title level={4} className="!m-0 !text-lg">
                    Start from a template
                </Typography.Title>
                <Button
                    type="text"
                    size="small"
                    icon={<ArrowLeft size={14} />}
                    onClick={() => setBrowseAll(false)}
                >
                    Back
                </Button>
            </div>

            <TemplatesSection hideHeader onSelectTemplate={selectTemplate} />
        </Reveal>
    )
}

export default OnboardingBrowseTemplates
