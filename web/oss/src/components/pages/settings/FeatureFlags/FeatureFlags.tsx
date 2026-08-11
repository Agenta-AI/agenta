import {Warning} from "@phosphor-icons/react"
import {Switch, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {navSimplifiedOverrideAtom} from "@/oss/lib/onboarding/atoms"
import {advancedNavHiddenAtom} from "@/oss/state/onboarding/selectors"
import {
    agentVoiceInputEnabledAtom,
    agentaChannelSurfaceEnabledAtom,
    playgroundInspectorEnabledAtom,
} from "@/oss/state/settings/featureFlags"

interface FlagRowProps {
    title: string
    description: string
    enabled: boolean
    onChange: (enabled: boolean) => void
}

const FlagRow = ({title, description, enabled, onChange}: FlagRowProps) => (
    <div className="flex items-start gap-3">
        <Switch
            checked={enabled}
            onChange={onChange}
            aria-label={title}
            className="mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
            <Typography.Text strong>{title}</Typography.Text>
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-0.5">
                {description}
            </Typography.Paragraph>
        </div>
    </div>
)

const FeatureFlags = () => {
    const advancedNavHidden = useAtomValue(advancedNavHiddenAtom)
    const setNavSimplifiedOverride = useSetAtom(navSimplifiedOverrideAtom)
    const [playgroundInspectorEnabled, setPlaygroundInspectorEnabled] = useAtom(
        playgroundInspectorEnabledAtom,
    )
    const [agentVoiceInputEnabled, setAgentVoiceInputEnabled] = useAtom(agentVoiceInputEnabledAtom)
    const [agentaChannelSurfaceEnabled, setAgentaChannelSurfaceEnabled] = useAtom(
        agentaChannelSurfaceEnabledAtom,
    )

    return (
        <section className="flex max-w-[640px] flex-col gap-8">
            <div className="flex flex-col gap-4">
                <Typography.Paragraph type="secondary" className="!mb-0">
                    Choose how you want to experience the platform.
                </Typography.Paragraph>
                <FlagRow
                    title="Classic mode"
                    description="Show all platform areas in the navigation."
                    enabled={!advancedNavHidden}
                    onChange={(enabled) => setNavSimplifiedOverride(!enabled)}
                />
                <FlagRow
                    title="Voice input"
                    description="Dictate messages in the agent chat."
                    enabled={agentVoiceInputEnabled}
                    onChange={setAgentVoiceInputEnabled}
                />
            </div>

            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <Typography.Title level={5} className="!mb-0 flex items-center gap-2">
                        <Warning size={16} className="text-colorError" />
                        Debug flags
                    </Typography.Title>
                    <Typography.Paragraph type="secondary" className="!mb-0">
                        Enable troubleshooting tools when you need more technical detail.
                    </Typography.Paragraph>
                </div>
                <FlagRow
                    title="Playground inspector"
                    description="Show controls for inspecting Playground sessions and individual turns."
                    enabled={playgroundInspectorEnabled}
                    onChange={setPlaygroundInspectorEnabled}
                />
                <FlagRow
                    title="Agenta channel surface"
                    description="A minimal probe page for the Agenta channel API: bots, conversations, and the rendering vocabulary. Not the real chat surface."
                    enabled={agentaChannelSurfaceEnabled}
                    onChange={setAgentaChannelSurfaceEnabled}
                />
            </div>
        </section>
    )
}

export default FeatureFlags
