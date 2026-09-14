import {SlackLogo} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue} from "jotai"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {useChannelSetupQuery} from "@/oss/state/channels"
import {projectIdAtom} from "@/oss/state/project"

import {ChannelsSectionHeader} from "./ChannelsSection"

// Builds the install link from the project in scope -- exported so the test
// can assert on it without rendering the button.
export function buildSlackInstallUrl(projectId: string): string {
    const params = new URLSearchParams({project_id: projectId})
    return `${getAgentaApiUrl()}/channels/catalog/channels/slack/install/?${params.toString()}`
}

// Settings -> Channels -> Add Slack -> Use the Agenta app: one click, no manifest, no paste form.
// Renders nothing when this deployment never configured the hosted app -- absent, not disabled.
export default function SlackHostedAppSection() {
    const {setup, isLoading} = useChannelSetupQuery("slack")
    const projectId = useAtomValue(projectIdAtom)

    if (isLoading || !setup?.hosted_available || !projectId) return null

    return (
        <section className="flex flex-col gap-3">
            <ChannelsSectionHeader
                icon={<SlackLogo size={16} />}
                title="Add Slack (one click)"
                description="Install the Slack app we host. Nothing to build, nothing to paste."
            />
            <Button
                type="primary"
                icon={<SlackLogo size={16} />}
                href={buildSlackInstallUrl(projectId)}
                className="w-fit"
            >
                Install to Slack
            </Button>
        </section>
    )
}
