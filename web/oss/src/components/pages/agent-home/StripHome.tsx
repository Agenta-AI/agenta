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

    const handleCreate = useCallback(
        (markdown?: string) => {
            onCreate(provenance.resolveTemplateName(), markdown)
        },
        [onCreate, provenance.resolveTemplateName],
    )

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
            {/* One centered 1040px column — hero, composer, templates, usage, and the table all
                share the same left/right edges. PageLayout's p-4 supplies the outer 16px, the
                px-6 here tops it up to ~40px sides; pt-14/pb-20 give the page air (≈72/96px). */}
            <div className="mx-auto flex w-full max-w-[1040px] flex-col px-6 pb-20 pt-14">
                {/* Hero + composer keep a readable 840px measure, centered in the column (a
                    full-width text area reads worse, not better). The hero text is centered so
                    the narrower block reads as a deliberate hero above the full-width sections. */}
                <div className="mx-auto flex w-full max-w-[840px] flex-col">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <Typography.Title level={2} className="!m-0 !text-[30px] !leading-tight">
                            {HERO.title}
                        </Typography.Title>
                        <Typography.Text className="!text-[15px] !text-[var(--ag-colorTextSecondary)]">
                            {HERO.subtitle}
                        </Typography.Text>
                    </div>

                    {/* Chip docks flush above the composer (no gap; the chip has no bottom border).
                        It's absolutely positioned INTO the 44px hero gap (bottom-full), so the
                        subtitle→composer distance is exactly mt-11 with or without a chip — the
                        invisible reserved slot no longer inflates the gap. The 2px nudge overlaps
                        the composer's top border so the chip opens into it instead of sitting on a
                        seam line; z-10 keeps the chip painting ABOVE the (relative) composer, whose
                        border would otherwise draw over the overlap. */}
                    <div className="relative mt-11 flex flex-col items-stretch">
                        <div className="absolute bottom-full left-0 z-10 translate-y-[2px]">
                            {provenance.chipNode}
                        </div>
                        <StripComposer
                            composerRef={composerRef}
                            onCreate={handleCreate}
                            onCodingAgentCopy={handleCodingAgentCopy}
                            composerClassName={provenance.composerClassName}
                            onTextChange={provenance.onComposerTextChange}
                        />
                    </div>
                </div>

                <TemplateStrip
                    className="mt-20"
                    surface="home"
                    layout="grid"
                    selectedTemplateKey={provenance.selectedTemplateKey}
                    onPick={handlePick}
                />

                {!firstRun ? (
                    <>
                        <div className="mt-16">
                            <UsageSummary variant="strip" />
                        </div>
                        <div className="mt-16">
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
