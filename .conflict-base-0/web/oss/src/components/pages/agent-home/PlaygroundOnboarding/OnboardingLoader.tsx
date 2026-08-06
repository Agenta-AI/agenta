import {AgentConfigSkeleton} from "@agenta/entity-ui"
import {Button} from "antd"

import AgentChatSkeleton from "@/oss/components/AgentChatSlice/components/AgentChatSkeleton"
import PlaygroundLoadingShell from "@/oss/components/PlaygroundRouter/PlaygroundLoadingShell"

interface OnboardingLoaderProps {
    /** Mint failed — show a retry affordance instead of an endless skeleton. */
    // Error | null covers next/dynamic's DynamicOptionsLoadingProps when used as a `loading` fallback.
    error?: boolean | Error | null
    onRetry?: () => void
}

/**
 * Two-pane agent skeleton (config rail + chat canvas) mirroring the live `PlaygroundMainView` geometry —
 * 440px raised config panel with its "Configuration" header + section rows, and the recessed chat canvas —
 * so the loader morphs into the real layout without a shift. Both skeletons (`AgentConfigSkeleton`,
 * `AgentChatSkeleton`) are provider-free; only the splitter frame + header are reconstructed as static
 * markup here (the live ones are provider-bound).
 */
const AgentPlaygroundSkeleton = () => (
    <div className="ag-app-ground relative flex h-full w-full overflow-hidden">
        <div className="ag-panel-raised flex h-full min-h-0 w-[440px] shrink-0 flex-col overflow-hidden">
            <div className="flex h-[48px] shrink-0 items-center border-0 border-b border-solid border-colorBorderSecondary bg-[var(--ag-c-FFFFFF)] bg-[image:linear-gradient(var(--ant-color-fill-tertiary),var(--ant-color-fill-tertiary))] px-4 py-2">
                <span className="text-[13px] font-semibold text-[var(--ant-color-text)]">
                    Configuration
                </span>
            </div>
            <div className="min-h-0 grow overflow-hidden p-4">
                <AgentConfigSkeleton />
            </div>
        </div>
        <div className="ag-canvas min-w-0 grow overflow-hidden">
            <AgentChatSkeleton />
        </div>
    </div>
)

/**
 * The single loading surface for playground-native onboarding. Used at every boundary the onboarding flow
 * crosses — the `/apps` redirect decision, the lazy-`Playground` chunk download, and the ephemeral mint —
 * so the user sees ONE continuous screen: the real agent playground shell (agent page header + two-pane
 * config/chat skeleton) rather than a bare spinner. Onboarding always targets an agent, so we force the
 * agent chrome without waiting for any data to resolve. On mint failure the body swaps to an error + Retry
 * so the flow never dead-ends.
 */
const OnboardingLoader = ({error, onRetry}: OnboardingLoaderProps = {}) => (
    <PlaygroundLoadingShell agent>
        {error ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                    Couldn&apos;t set up your agent.
                </span>
                {onRetry ? (
                    <Button onClick={onRetry} type="primary">
                        Try again
                    </Button>
                ) : null}
            </div>
        ) : (
            <AgentPlaygroundSkeleton />
        )}
    </PlaygroundLoadingShell>
)

export default OnboardingLoader
