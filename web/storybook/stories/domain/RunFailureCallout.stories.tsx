import {RunFailureCallout} from "@agenta/chat/components"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * **What a turn says when the run failed.** One component for both apps: it was written twice,
 * once per app, with its own clamp threshold and its own retry rule in each.
 *
 * The recovery verb is the interesting part. It comes from the failure class, and the two escapes
 * that leave the chat are props, so an app with nowhere to send the reader draws neither.
 */
const meta = {
    title: "@agenta/chat/Domain/RunFailureCallout",
    component: RunFailureCallout,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The failed-run callout: the reason, clamped when it is a stacktrace, and " +
                    "the one recovery verb the failure class earns.",
            },
        },
    },
    decorators: [
        (Story) => (
            <div className="w-[560px] max-w-full">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof RunFailureCallout>

export default meta
type Story = StoryObj<typeof meta>

/** An everyday reason: shown in full, with nothing to click. */
export const EverydayReason: Story = {
    args: {text: "model authentication failed", stateKey: "story-everyday"},
}

/** A stacktrace clamps to three lines behind "Show more", so it cannot drown the transcript. */
export const BigReason: Story = {
    args: {
        text: [
            "Traceback (most recent call last):",
            '  File "/app/runner.py", line 214, in execute',
            "    result = await self._invoke(request)",
            '  File "/app/runner.py", line 388, in _invoke',
            "    raise RunnerError(response.text)",
            "RunnerError: upstream returned 502 after 3 attempts",
        ].join("\n"),
        stateKey: "story-big",
    },
}

/** A transient class, with a retry wired: running the turn again is the whole fix. */
export const Retryable: Story = {
    args: {
        text: "A temporary issue kept this run's credentials from reaching the model.",
        stateKey: "story-retry",
        code: "credential_delivery_failed",
        onRetry: () => undefined,
    },
}

/** Out of starter credits, on an app that has a provider drawer to open. */
export const StarterCreditsExhausted: Story = {
    args: {
        text: "Out of starter credits.",
        stateKey: "story-credits",
        code: "starter_credits_exhausted",
        onAddKey: () => undefined,
    },
}

/** The stored subscription sign-in is dead. A new key would not fix it and neither would a retry. */
export const SubscriptionLoginRequired: Story = {
    args: {
        text: "The ChatGPT sign-in is no longer valid. Sign in again from AI providers.",
        stateKey: "story-signin",
        code: "subscription_login_required",
        onSignIn: () => undefined,
        onRetry: () => undefined,
    },
}

/** An admission refusal: the message never went, so the title says that instead. */
export const MessageNotSent: Story = {
    args: {
        text: "This session already has a turn running.",
        stateKey: "story-not-sent",
        code: "session_turn_in_use",
        onRetry: () => undefined,
    },
}
