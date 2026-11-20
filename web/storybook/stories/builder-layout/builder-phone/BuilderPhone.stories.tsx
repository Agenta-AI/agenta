import {useState} from "react"

import {ApprovalCard} from "@agenta/chat/components"
import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {BuilderHeader} from "../../../../mobile/src/features/builder/BuilderHeader"
import {ChatHistoryList} from "../../../../mobile/src/features/builder/ChatHistoryList"
import {ContextChip} from "../../../../mobile/src/features/builder/ContextChip"
import {NewChatIntro} from "../../../../mobile/src/features/builder/NewChatIntro"
import {QuickActions} from "../../../../mobile/src/features/builder/QuickActions"
import {RecentChats} from "../../../../mobile/src/features/builder/RecentChats"
import {pageSessionIdAtom} from "../../../../mobile/src/features/chat/pageSessionId"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    BUILDER_CHATS,
    BUILDER_PANEL_AGENT,
    PAGE_SESSION,
    URGENCY_CHANGE,
} from "../../../fixtures/builderLayout/builder-phone"

const noop = () => undefined

/**
 * The builder full screen on a phone, at 390 x 844: M04 new chat, M05 change card, M06 chat
 * history. The header, the new chat, the chip, the quick actions, the recent chats, the history
 * and the change card are the production components with `phone` on; the composer frame stands in
 * for the production composer, which needs a live conversation.
 */
const BuilderPhoneFrame = ({
    projectId,
    view,
}: {
    projectId: string
    view: "new" | "card" | "history"
}) => {
    const t = useT(builderPanelCatalog)
    const [search, setSearch] = useState("")
    const rows = BUILDER_CHATS.filter((row) =>
        row.name?.toLowerCase().includes(search.trim().toLowerCase()),
    )
    const composer = (
        <div className="flex flex-col gap-2 rounded-xl p-3 ring-1 ring-inset ring-colorBorderSecondary">
            <ContextChip projectId={projectId} agentName={BUILDER_PANEL_AGENT} phone />
            <span className="text-[15px] text-colorTextTertiary">
                {t("builder.panel.placeholder")}
            </span>
        </div>
    )
    return (
        <div
            data-testid="builder-phone-story"
            className="flex h-[844px] w-[390px] flex-col bg-background"
        >
            <BuilderHeader
                title={
                    view === "card" ? "Urgency of the Safari ticket" : t("builder.panel.newChat")
                }
                isHistory={view === "history"}
                menuRows={BUILDER_CHATS.slice(0, 5)}
                onBack={noop}
                onOpenChat={noop}
                onOpenHistory={noop}
                onNewChat={noop}
                openInBuilderHref="#"
                onClose={noop}
                phone
                backTitle="Session"
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
                    phone
                />
            ) : view === "card" ? (
                <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 px-3 pb-3">
                    <ApprovalCard
                        approvals={[URGENCY_CHANGE]}
                        touch
                        onRespond={noop}
                        onApproveAll={noop}
                    />
                    {composer}
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
                    <NewChatIntro agentName={BUILDER_PANEL_AGENT} />
                    {composer}
                    <QuickActions sessionId="story-phone-new-chat" onPick={noop} phone />
                    <RecentChats
                        rows={BUILDER_CHATS}
                        failed={false}
                        onRetry={noop}
                        onOpen={noop}
                        onViewAll={noop}
                        phone
                    />
                </div>
            )}
        </div>
    )
}

const meta = {
    title: "BuilderLayout/builder-phone/Builder on a phone",
    component: BuilderPhoneFrame,
    parameters: {
        layout: "fullscreen",
        agenta: {
            args: (scope: StoryScope) => ({projectId: scope.projectId}),
            atoms: [[pageSessionIdAtom, PAGE_SESSION.id]],
            queries: (scope: StoryScope) => [
                [["session-stream", scope.projectId, PAGE_SESSION.id], {name: PAGE_SESSION.name}],
            ],
        },
    },
    args: {projectId: "", view: "new"},
} satisfies Meta<typeof BuilderPhoneFrame>

export default meta
type Story = StoryObj<typeof meta>

/** M04: the new chat with the chip, the five quick actions and three recent chats. */
export const NewChat: Story = {}

/** M04 in the dark theme. */
export const NewChatDark: Story = {globals: {theme: "dark"}}

/** M05: the change card at full width with 44 px Deny and Approve. */
export const ChangeCard: Story = {args: {view: "card"}}

/** M06: the chat history with its search. */
export const ChatHistory: Story = {args: {view: "history"}}
