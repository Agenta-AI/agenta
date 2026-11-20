import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {BrowseIdeasDialog} from "../../../../mobile/src/features/builder-page/BrowseIdeasDialog"
import {NewBuilderChat} from "../../../../mobile/src/features/builder-page/NewBuilderChat"
import {PageQuickActions} from "../../../../mobile/src/features/builder-page/PageQuickActions"

const noop = () => undefined

/**
 * The middle of the builder page for a new chat (B01) and with "Browse ideas" open (B02). The
 * hero, the title, the quick actions and the ideas dialog are the page's own components; the
 * composer frame stands in for the production composer, which needs a live conversation.
 */
const NewChatFrame = ({ideas}: {ideas: boolean}) => {
    const t = useT(builderPageCatalog)
    return (
        <div
            data-testid="builder-page-story"
            className="flex h-[820px] w-[960px] flex-col bg-background"
        >
            <div className="flex h-12 shrink-0 items-center border-0 border-b border-solid border-colorBorderSecondary px-4 text-[15px] font-semibold">
                {t("builder.page.newChat")}
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6">
                <NewBuilderChat heroState="idle" />
                <div className="flex w-full max-w-[680px] flex-col gap-3">
                    <PageQuickActions onFill={noop} onPickAgent={noop} onBrowseIdeas={noop} />
                    <div className="flex h-24 flex-col rounded-xl p-3 ring-1 ring-inset ring-colorBorderSecondary">
                        <span className="text-sm text-colorTextTertiary">
                            {t("builder.page.placeholderNew")}
                        </span>
                    </div>
                </div>
            </div>
            <BrowseIdeasDialog open={ideas} onOpenChange={noop} onPick={noop} />
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

/** B01: a new chat with the hero, the line, the five quick actions and the composer. */
export const NewChat: Story = {}

/** B02: "Browse ideas" open on "All". */
export const BrowseIdeas: Story = {args: {ideas: true}}
