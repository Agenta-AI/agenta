import {Collapse, Typography} from "antd"

import AddAgentForm from "./components/AddAgentForm"
import AddGrantForm from "./components/AddGrantForm"
import BotPicker from "./components/BotPicker"
import ConversationPanel from "./components/ConversationPanel"
import CreateBotForm from "./components/CreateBotForm"

/**
 * The throwaway probe for the Agenta channel API: proves the API end to end
 * and renders the node vocabulary richly and degraded -- not a design
 * deliverable, and deleted once the real chat surface replaces it.
 */
export default function AgentaChannelSurface() {
    return (
        <div className="flex max-w-[720px] flex-col gap-6">
            <Typography.Paragraph type="secondary" className="!mb-0">
                A minimal probe for the Agenta channel: create a bot, add an agent, grant it a
                space, then chat. Not the real surface.
            </Typography.Paragraph>

            <Collapse
                items={[
                    {
                        key: "config",
                        label: "Configuration (create a bot, add an agent, set a grant)",
                        children: (
                            <div className="flex flex-col gap-3">
                                <CreateBotForm />
                                <AddAgentForm />
                                <AddGrantForm />
                            </div>
                        ),
                    },
                ]}
            />

            <BotPicker />
            <ConversationPanel />
        </div>
    )
}
