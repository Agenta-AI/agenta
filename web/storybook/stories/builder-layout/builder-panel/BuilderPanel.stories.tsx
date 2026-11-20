import {useState} from "react"

import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {BuilderHeader} from "../../../../mobile/src/features/builder/BuilderHeader"
import {ChatHistoryList} from "../../../../mobile/src/features/builder/ChatHistory"
import {RecentChats} from "../../../../mobile/src/features/builder/ChatRows"
import {ContextChip} from "../../../../mobile/src/features/builder/ContextChip"
import {NewChatIntro} from "../../../../mobile/src/features/builder/NewChatIntro"
import {QuickActions} from "../../../../mobile/src/features/builder/QuickActions"
import {
    writeOpenQuickAction,
    type QuickAction,
} from "../../../../mobile/src/features/builder/quickActions"
import {pageSessionIdAtom} from "../../../../mobile/src/features/chat/pageSessionId"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    BUILDER_CHATS,
    BUILDER_PANEL_AGENT,
    PAGE_SESSION,
} from "../../../fixtures/builderLayout/builder-panel"

const noop = () => undefined

/**
 * The builder panel of S07, S08 and S09 at its 440 px width. The header, the new chat, the chip,
 * the quick actions, the recent chats and the history are the panel's own components; the
 * composer frame stands in for the production composer, which needs a live conversation.
 */
const BuilderPanelFrame = ({
    projectId,
    view,
    openAction,
}: {
    projectId: string
    view: "new" | "history"
    openAction?: QuickAction
}) => {
    const t = useT(builderPanelCatalog)
    const sessionId = `story-new-chat-${openAction ?? "none"}`
    // Before the first render: the quick actions read it when they mount.
    useState(() => writeOpenQuickAction(sessionId, openAction ?? null))
    const [search, setSearch] = useState("")
    const rows = BUILDER_CHATS.filter((row) =>
        row.name?.toLowerCase().includes(search.trim().toLowerCase()),
    )
    return (
        <div
            data-testid="builder-panel-story"
            className="flex h-[860px] w-[440px] flex-col border-0 border-l border-solid border-colorBorderSecondary bg-background"
        >
            <BuilderHeader
                title={t("builder.panel.newChat")}
                isHistory={view === "history"}
                menuRows={BUILDER_CHATS.slice(0, 5)}
                onBack={noop}
                onOpenChat={noop}
                onOpenHistory={noop}
                onNewChat={noop}
                openInBuilderHref="#"
                onClose={noop}
            />
            {view === "history" ? (
                <ChatHistoryList
                    rows={rows}
                    pending={false}
                    failed={false}
                    search={search}
                    onSearch={setSearch}
                    onRetry={noop}
                    onOpen={noop}
                />
            ) : (
                <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-y-auto p-3">
                    <NewChatIntro agentName={BUILDER_PANEL_AGENT} />
                    <div className="flex flex-col gap-2 rounded-xl p-3 ring-1 ring-inset ring-colorBorderSecondary">
                        <ContextChip projectId={projectId} agentName={BUILDER_PANEL_AGENT} />
                        <span className="text-sm text-colorTextTertiary">
                            {t("builder.panel.placeholder")}
                        </span>
                    </div>
                    <QuickActions sessionId={sessionId} onPick={noop} />
                    <RecentChats
                        rows={BUILDER_CHATS}
                        failed={false}
                        onRetry={noop}
                        onOpen={noop}
                        onViewAll={noop}
                    />
                </div>
            )}
        </div>
    )
}

const meta = {
    title: "BuilderLayout/builder-panel/Builder panel",
    component: BuilderPanelFrame,
    parameters: {
        layout: "centered",
        agenta: {
            args: (scope: StoryScope) => ({projectId: scope.projectId}),
            atoms: [[pageSessionIdAtom, PAGE_SESSION.id]],
            queries: (scope: StoryScope) => [
                [["session-stream", scope.projectId, PAGE_SESSION.id], {name: PAGE_SESSION.name}],
            ],
        },
    },
    args: {projectId: "", view: "new"},
} satisfies Meta<typeof BuilderPanelFrame>

export default meta
type Story = StoryObj<typeof meta>

/** S07: a new chat with the chip, the five quick actions and three recent chats. */
export const NewChat: Story = {}

/** S08: "Test" open with its three ready requests. */
export const QuickActionOpen: Story = {args: {openAction: "test"}}

/** S09: the chat history with its search. */
export const ChatHistory: Story = {args: {view: "history"}}
