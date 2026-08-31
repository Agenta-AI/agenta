import type {Meta, StoryObj} from "@storybook/react"

import AttachmentCard from "./AttachmentCard"
import AttachmentCardGrid from "./AttachmentCardGrid"

const meta: Meta<typeof AttachmentCard> = {
    title: "Chat/AttachmentCard",
    component: AttachmentCard,
    parameters: {layout: "padded"},
}
export default meta

type Story = StoryObj<typeof AttachmentCard>

/** A 1x1 PNG, so the image stories render a real decoded thumbnail with no network. */
const PIXEL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg=="

export const Image: Story = {
    args: {
        name: "canyon-arch.jpg",
        mediaType: "image/jpeg",
        src: PIXEL,
        action: "remove",
        onRemove: () => {},
    },
}

export const Audio: Story = {
    args: {
        name: "clean-mouse-click.wav",
        mediaType: "audio/wav",
        src: "",
        action: "remove",
        onRemove: () => {},
    },
}

export const Document: Story = {
    args: {
        name: "account_overview_analytics (1).csv",
        mediaType: "text/csv",
        action: "remove",
        onRemove: () => {},
    },
}

/** The thumbnail slot falls back rather than rendering a broken image. */
export const BrokenImage: Story = {
    args: {
        name: "hero-crop.jpg",
        mediaType: "image/jpeg",
        src: "/does-not-exist.png",
        action: "remove",
        onRemove: () => {},
    },
}

export const Uploading: Story = {
    args: {
        name: "dune-crest.jpg",
        mediaType: "image/jpeg",
        src: PIXEL,
        state: "uploading",
        progress: 62,
    },
}

export const Rejected: Story = {
    args: {
        name: "blob-red.heic",
        mediaType: "image/heic",
        state: "error",
        errorReason: "too large",
        action: "remove",
        onRemove: () => {},
    },
}

/** Video keeps the play affordance but opens in a viewer — an <audio> tag has no picture. */
export const Video: Story = {
    args: {
        name: "voice-note.webm",
        mediaType: "video/webm",
        action: "remove",
        onRemove: () => {},
        onView: () => {},
    },
}

/** The source is still resolving; a placeholder rather than a broken thumbnail. */
export const Loading: Story = {
    args: {name: "dune-crest.jpg", mediaType: "image/jpeg", loading: true, action: "none"},
}

/** Long names truncate rather than wrapping — every card stays one row tall. */
export const LongName: Story = {
    args: {
        name: "quarterly-revenue-by-region-and-product-line-final-v7-reviewed.csv",
        mediaType: "text/csv",
        action: "remove",
        onRemove: () => {},
    },
}

export const Downloadable: Story = {
    args: {
        name: "account_overview_analytics (1).csv",
        mediaType: "text/csv",
        action: "download",
        onDownload: () => {},
    },
}

const card = (name: string, mediaType: string, src?: string) => (
    <AttachmentCard
        key={name + src}
        name={name}
        mediaType={mediaType}
        src={src}
        action="remove"
        onRemove={() => {}}
    />
)

/**
 * The layout rule that matters: a short final row grows to fill the width, whether one card is
 * left over or two. Resize the viewport across `md` to see two columns become three.
 */
export const GridOrphanRule: StoryObj = {
    render: () => (
        <div className="flex flex-col gap-6">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <div key={n} className="flex flex-col gap-1.5">
                    <span className="text-xs text-colorTextTertiary">{n} attachments</span>
                    <AttachmentCardGrid>
                        {Array.from({length: n}, (_, i) =>
                            card(`file-${i + 1}.csv`, "text/csv", String(i)),
                        )}
                    </AttachmentCardGrid>
                </div>
            ))}
        </div>
    ),
}

/** Past the cap the tray scrolls, leaving a part-row visible as the affordance. */
export const GridScrolls: StoryObj = {
    render: () => (
        <AttachmentCardGrid maxHeight={180}>
            {Array.from({length: 14}, (_, i) => card(`file-${i + 1}.csv`, "text/csv", String(i)))}
        </AttachmentCardGrid>
    ),
}

/** Mixed kinds share one row height, which is what makes the wrap read as a grid. */
export const GridMixedKinds: StoryObj = {
    render: () => (
        <AttachmentCardGrid>
            {card("canyon-arch.jpg", "image/jpeg", PIXEL)}
            {card("clean-mouse-click.wav", "audio/wav")}
            {card("account_overview_analytics (1).csv", "text/csv")}
            <AttachmentCard
                name="blob-red.heic"
                mediaType="image/heic"
                state="error"
                errorReason="too large"
                action="remove"
                onRemove={() => {}}
            />
            <AttachmentCard
                name="site-map.png"
                mediaType="image/png"
                src={PIXEL}
                state="uploading"
                progress={40}
            />
        </AttachmentCardGrid>
    ),
}
