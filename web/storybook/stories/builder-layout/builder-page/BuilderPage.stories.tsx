import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {MoreIdeasDialog} from "../../../../mobile/src/features/builder-page/MoreIdeasDialog"
import {NewBuilderChat} from "../../../../mobile/src/features/builder-page/NewBuilderChat"
import {PageQuickActions} from "../../../../mobile/src/features/builder-page/PageQuickActions"

const noop = () => undefined

/**
 * The middle of the builder page for a new chat (B01) and with "More ideas" open (B02). The
 * hero, the title, the quick actions and the ideas dialog are the page's own components; the
 * composer frame stands in for the production composer, which needs a live conversation.
 */
const NewChatFrame = ({ideas, phone = false}: {ideas: boolean; phone?: boolean}) => {
    const t = useT(builderPageCatalog)
    return (
        <div
            data-testid="builder-page-story"
            className={
                phone
                    ? "flex h-[844px] w-[390px] flex-col bg-background"
                    : "flex h-[820px] w-[960px] flex-col bg-background"
            }
        >
            <div className="flex h-12 shrink-0 items-center border-0 border-b border-solid border-colorBorderSecondary px-4 text-[15px] font-semibold">
                {t("builder.page.newChat")}
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-4">
                <NewBuilderChat heroState="idle" />
                {/* The quick actions sit above the composer, as in the app (B01). */}
                <div className="flex w-full max-w-[680px] flex-col gap-2.5">
                    <PageQuickActions onFill={noop} onPickAgent={noop} onMoreIdeas={noop} />
                    <div className="flex h-24 flex-col rounded-xl p-3 ring-1 ring-inset ring-colorBorderSecondary">
                        <span className="text-sm text-colorTextTertiary">
                            {t("builder.page.placeholderNew")}
                        </span>
                    </div>
                </div>
            </div>
            <MoreIdeasDialog open={ideas} onOpenChange={noop} onPick={noop} container={null} />
        </div>
    )
}

const meta = {
    title: "BuilderLayout/builder-page/Builder page",
    component: NewChatFrame,
    parameters: {layout: "centered"},
    args: {ideas: false},
} satisfies Meta<typeof NewChatFrame>

export default meta
type Story = StoryObj<typeof meta>

/** B01: a new chat with the hero, the line, the three actions, "More ideas" and the composer. */
export const NewChat: Story = {}

/** B02: "More ideas" open on "All". */
export const MoreIdeas: Story = {args: {ideas: true}}

/** B01 at 390 px: the actions scroll sideways in one row. */
export const NewChatPhone: Story = {
    args: {phone: true},
    parameters: {viewport: {defaultViewport: "mobile1"}},
}

/** B02 at 390 px. */
export const MoreIdeasPhone: Story = {
    args: {ideas: true, phone: true},
    parameters: {viewport: {defaultViewport: "mobile1"}},
}
