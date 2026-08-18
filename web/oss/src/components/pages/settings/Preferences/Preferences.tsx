import {Divider, Switch, Tag, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {navSimplifiedOverrideAtom} from "@/oss/lib/onboarding/atoms"
import {advancedNavHiddenAtom} from "@/oss/state/onboarding/selectors"
import {
    agentVoiceInputEnabledAtom,
    playgroundInspectorEnabledAtom,
} from "@/oss/state/settings/featureFlags"

import ThemePicker from "./components/ThemePicker"

interface FlagRowProps {
    title: string
    description: string
    enabled: boolean
    onChange: (enabled: boolean) => void
    badge?: string
}

const FlagRow = ({title, description, enabled, onChange, badge}: FlagRowProps) => (
    <div className="flex items-start gap-3 border-0 border-b border-solid border-colorSplit py-4 first:pt-0 last:border-b-0 last:pb-0">
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
                <Typography.Text strong>{title}</Typography.Text>
                {badge ? (
                    <Tag className="!m-0" color="default">
                        {badge}
                    </Tag>
                ) : null}
            </div>
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-0.5">
                {description}
            </Typography.Paragraph>
        </div>
        <Switch
            checked={enabled}
            onChange={onChange}
            aria-label={title}
            className="mt-0.5 shrink-0"
        />
    </div>
)

const SectionHeader = ({title}: {title: string}) => (
    <div className="flex flex-col gap-2">
        <Typography.Title level={5} className="!mb-0">
            {title}
        </Typography.Title>
        <Divider className="!m-0" />
    </div>
)

const Preferences = () => {
    const advancedNavHidden = useAtomValue(advancedNavHiddenAtom)
    const setNavSimplifiedOverride = useSetAtom(navSimplifiedOverrideAtom)
    const [playgroundInspectorEnabled, setPlaygroundInspectorEnabled] = useAtom(
        playgroundInspectorEnabledAtom,
    )
    const [agentVoiceInputEnabled, setAgentVoiceInputEnabled] = useAtom(agentVoiceInputEnabledAtom)

    return (
        <section className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
                <SectionHeader title="Appearance" />
                <div className="flex flex-col gap-2">
                    <Typography.Text strong>Theme</Typography.Text>
                    <ThemePicker />
                </div>
            </div>

            <div className="flex flex-col gap-4">
                <SectionHeader title="Feature flags" />
                <div className="flex flex-col">
                    <FlagRow
                        title="Developer mode"
                        description="Show Prompts, Evaluation, Observability, and Registry in the navigation."
                        // Stored preference is the inverse ("nav simplified"); only the UI flips it.
                        enabled={!advancedNavHidden}
                        onChange={(enabled) => setNavSimplifiedOverride(!enabled)}
                    />
                    <FlagRow
                        title="Voice input"
                        description="Dictate messages in the agent chat."
                        enabled={agentVoiceInputEnabled}
                        onChange={setAgentVoiceInputEnabled}
                    />
                    <FlagRow
                        title="Playground inspector"
                        description="Show controls for inspecting Playground sessions and individual turns."
                        enabled={playgroundInspectorEnabled}
                        onChange={setPlaygroundInspectorEnabled}
                        badge="DEBUG"
                    />
                </div>
            </div>
        </section>
    )
}

export default Preferences
