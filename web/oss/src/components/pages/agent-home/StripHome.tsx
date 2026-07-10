import {useCallback, useRef, useState} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {PageLayout} from "@agenta/ui"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {App, Typography} from "antd"
import {useAtomValue} from "jotai"

import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
import TemplateStrip from "@/oss/components/TemplateStrip"
import {buildCodingAgentClipboard} from "@/oss/components/TemplateStrip/assets/codingAgentClipboard"
import {STRIP_COPY} from "@/oss/components/TemplateStrip/assets/constants"
import CopiedToast from "@/oss/components/TemplateStrip/components/CopiedToast"
import StripComposer from "@/oss/components/TemplateStrip/components/StripComposer"
import {useTemplateProvenance} from "@/oss/components/TemplateStrip/hooks/useTemplateProvenance"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {HERO} from "./assets/constants"
import {captureFirstAgentIntent, truncateForCapture} from "./assets/onboardingAnalytics"
import {type AgentTemplate} from "./assets/templates"
import UsageSummary from "./components/UsageSummary"
import YourAgentsTable from "./components/YourAgentsTable"
import {useAgentHomeActions} from "./hooks/useAgentHomeActions"
import {useAgentHomeVariants} from "./hooks/useAgentHomeVariants"

/**
 * The strip-era home layout (TEMPLATE_STRIP_MODE on): hero + composer (chip-docked) +
 * TemplateStrip + (returning users) the one-line Usage card and agents table. Replaces the
 * grid/drawer/IDE-modal flows entirely on this surface; those stay behind flag-off.
 */
const StripHome: React.FC = () => {
    const composerRef = useRef<RichChatInputHandle>(null)
    // Home creates, navigates to the playground, and auto-sends (owner decision).
    const {onCreate} = useAgentHomeActions(composerRef, {autoSendSeed: true})
    const {firstRunOverride} = useAgentHomeVariants()
    const posthog = usePostHogAg()
    const {message} = App.useApp()
    const [toastOpen, setToastOpen] = useState(false)

    // Warm the app-templates cache so the ephemeral-create factory resolves the agent template.
    useAtomValue(appTemplatesQueryAtom)

    const agents = useAtomValue(agentsWorkflowsAtom)
    const agentsLoading = useAtomValue(agentsWorkflowsLoadingAtom)
    const firstRun = firstRunOverride ?? (!agentsLoading && agents.length === 0)

    const provenance = useTemplateProvenance({
        composerApi: {
            setText: (text) => composerRef.current?.setMarkdown(text),
            getText: () => composerRef.current?.getMarkdown() ?? "",
        },
    })

    const handlePick = useCallback(
        (template: AgentTemplate) => {
            provenance.pick(template)
            captureFirstAgentIntent(posthog, {
                source: "template",
                properties: {
                    template: template.name,
                    templateId: template.key,
                    templateCategory: template.category,
                    mode: "strip",
                    surface: "home",
                },
                intentValue: template.category || template.name,
            })
        },
        [provenance.pick, posthog],
    )

    const handleCreate = useCallback(() => {
        onCreate(provenance.resolveTemplateName())
    }, [onCreate, provenance.resolveTemplateName])

    const handleCodingAgentCopy = useCallback(async () => {
        const text = composerRef.current?.getMarkdown().trim() ?? ""
        try {
            await navigator.clipboard.writeText(buildCodingAgentClipboard(text))
            setToastOpen(true)
        } catch {
            message.error("Couldn't copy — copy it manually")
            return
        }
        captureFirstAgentIntent(posthog, {
            source: "composer",
            properties: {action: "coding_agent_copy", message: truncateForCapture(text)},
        })
    }, [message, posthog])

    return (
        <PageLayout className="grow min-h-0">
            <div className="mx-auto flex w-full max-w-[960px] flex-col pb-16 pt-8">
                <div className="flex flex-col gap-3">
                    <Typography.Title level={2} className="!m-0 !text-[30px] !leading-tight">
                        {HERO.title}
                    </Typography.Title>
                    <Typography.Text className="!text-[15px] !text-[var(--ag-colorTextSecondary)]">
                        {HERO.subtitle}
                    </Typography.Text>
                </div>

                {/* Chip docks flush above the composer (no gap; the chip has no bottom border). */}
                <div className="mt-5 flex flex-col items-stretch">
                    {provenance.chipNode}
                    <StripComposer
                        composerRef={composerRef}
                        onCreate={handleCreate}
                        onCodingAgentCopy={handleCodingAgentCopy}
                        composerClassName={provenance.composerClassName}
                        onTextChange={provenance.onComposerTextChange}
                    />
                </div>

                <TemplateStrip
                    className="mt-[30px]"
                    surface="home"
                    selectedTemplateKey={provenance.selectedTemplateKey}
                    onPick={handlePick}
                />

                {!firstRun ? (
                    <>
                        <div className="mt-[30px]">
                            <UsageSummary variant="strip" />
                        </div>
                        <div className="mt-[30px]">
                            <YourAgentsTable />
                        </div>
                    </>
                ) : null}
            </div>

            <CopiedToast
                open={toastOpen}
                text={STRIP_COPY.copiedToast}
                onDone={() => setToastOpen(false)}
            />
        </PageLayout>
    )
}

export default StripHome
