import {ComposerRejections} from "@agenta/chat/components"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * **What the composer would not take, docked above it.** A warning, not an error: nothing broke
 * and nothing was lost, and the message still sends with whatever else was picked.
 *
 * Both apps mount it inside the shared composer, so a refused send reads the same on a phone and
 * on a desktop. Each row dismisses on its own, by position: two files can reject with the same
 * name for the same reason.
 */
const meta = {
    title: "@agenta/chat/Domain/ComposerRejections",
    component: ComposerRejections,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The refused-send and refused-attachment strip above the composer: a row " +
                    "per refusal, each with its own dismiss, scrolling past four.",
            },
        },
    },
    args: {onDismiss: () => undefined},
    decorators: [
        (Story) => (
            <div className="w-[560px] max-w-full">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof ComposerRejections>

export default meta
type Story = StoryObj<typeof meta>

/** A refused send, with the refusal's own stated reason. */
export const RefusedSend: Story = {
    args: {
        rejections: [{name: "Message", reason: "wasn't sent — No model provider is configured."}],
    },
}

/** A refusal with nothing stated behind it reads as the standing wording. */
export const RefusedSendWithoutAReason: Story = {
    args: {rejections: [{name: "Message", reason: "wasn't sent — try again."}]},
}

/** Refused attachments, which is the other thing this strip carries. */
export const RefusedAttachments: Story = {
    args: {
        rejections: [
            {name: "quarterly-deck.key", reason: "is not a supported file type."},
            {name: "recording.mov", reason: "is larger than 25 MB."},
        ],
    },
}

/** Past four rows it scrolls, so a bad multi-select cannot push the input off the screen. */
export const BeyondTheCap: Story = {
    args: {
        rejections: [
            {name: "one.pdf", reason: "is larger than 25 MB."},
            {name: "two.pdf", reason: "is larger than 25 MB."},
            {name: "three.pdf", reason: "is larger than 25 MB."},
            {name: "four.pdf", reason: "is larger than 25 MB."},
            {name: "five.pdf", reason: "is larger than 25 MB."},
            {name: "six.pdf", reason: "is larger than 25 MB."},
        ],
    },
}
