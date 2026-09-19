// @vitest-environment jsdom
/**
 * Which recovery verb a failed run offers, per failure class.
 *
 * The callout was written twice, as the desktop's `RunErrorBody` and the mobile app's private
 * `RunErrorCallout`, and only the desktop copy had this coverage. These cases moved here with the
 * component, so both apps are held to them.
 *
 * The two escapes that leave the chat are props, so a case that expects one has to wire it: that
 * is the distinction between "this failure class is clearable by adding a key" and "this app has
 * somewhere to add one".
 */
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {RunFailureCallout} from "../../../src/components/RunFailureCallout"

const noop = () => undefined

const text = (node: Parameters<typeof renderToStaticMarkup>[0]): string => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(node)
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("RunFailureCallout", () => {
    it("offers the own-key escape hatch when the run ran out of starter credits", () => {
        const rendered = text(
            <RunFailureCallout
                text="Out of starter credits."
                stateKey="turn-1"
                code="starter_credits_exhausted"
                onAddKey={noop}
            />,
        )

        expect(rendered).toContain("Out of starter credits.")
        expect(rendered).toContain("Add your key")
    })

    it("shows only the message when the failure carried no code", () => {
        const rendered = text(
            <RunFailureCallout
                text="Something broke."
                stateKey="turn-2"
                onAddKey={noop}
                onSignIn={noop}
            />,
        )

        expect(rendered).toContain("Something broke.")
        expect(rendered).not.toContain("Add your key")
    })

    it("withholds the own-key escape on an app with nowhere to add one", () => {
        // The mobile app has no provider drawer. The failure class is clearable, but a button
        // that opens nothing is worse than no button.
        const rendered = text(
            <RunFailureCallout
                text="Out of starter credits."
                stateKey="turn-1m"
                code="starter_credits_exhausted"
            />,
        )

        expect(rendered).toContain("Out of starter credits.")
        expect(rendered).not.toContain("Add your key")
    })

    it("withholds the sign-in escape on the same grounds", () => {
        const rendered = text(
            <RunFailureCallout
                text="The ChatGPT sign-in is no longer valid."
                stateKey="turn-sub-1m"
                code="subscription_login_required"
            />,
        )

        expect(rendered).toContain("no longer valid")
        expect(rendered).not.toContain("Sign in again")
    })

    it("clamps a stacktrace behind Show more and says so on the toggle", () => {
        const rendered = text(<RunFailureCallout text={"line\n".repeat(40)} stateKey="turn-big" />)

        expect(rendered).toContain("Show more")
    })

    it("leaves an everyday reason in full, with no toggle", () => {
        const rendered = text(
            <RunFailureCallout text="model authentication failed" stateKey="turn-small" />,
        )

        expect(rendered).not.toContain("Show more")
    })

    it("offers Try again for a transient credential-delivery failure", () => {
        const rendered = text(
            <RunFailureCallout
                text="A temporary issue kept this run's credentials from reaching the model."
                stateKey="turn-3"
                code="credential_delivery_failed"
                onRetry={() => undefined}
                onAddKey={noop}
                onSignIn={noop}
            />,
        )

        expect(rendered).toContain("Try again")
        expect(rendered).not.toContain("Add your key")
    })

    it("offers Try again for an offline send that failed before acceptance", () => {
        const rendered = text(
            <RunFailureCallout
                text="Could not reach Agenta. Check your connection and retry."
                stateKey="turn-offline"
                transport
                onRetry={() => undefined}
            />,
        )

        expect(rendered).toContain("The agent run failed")
        expect(rendered).toContain("Could not reach Agenta")
        expect(rendered).toContain("Try again")
    })

    it("hides Try again when no retry handler is wired (not the last turn, or busy)", () => {
        const rendered = text(
            <RunFailureCallout
                text="A temporary issue."
                stateKey="turn-4"
                code="credential_delivery_failed"
            />,
        )

        expect(rendered).not.toContain("Try again")
    })

    it("offers Sign in again when the subscription's stored sign-in is dead", () => {
        const rendered = text(
            <RunFailureCallout
                text="The ChatGPT sign-in is no longer valid. Sign in again from AI providers."
                stateKey="turn-sub-1"
                code="subscription_login_required"
                onRetry={() => undefined}
                onSignIn={noop}
            />,
        )

        expect(rendered).toContain("Sign in again")
        // A new key would not fix this, and re-running the same dead sign-in would not either.
        expect(rendered).not.toContain("Add your key")
        expect(rendered).not.toContain("Try again")
    })

    it("offers no verb at all when the config names a connection that does not exist", () => {
        // Signing in again cannot fix a name, and neither can re-running the same config, so
        // the message stands on its own. `subscription_connection_missing` must never join
        // the sign-in codes.
        const rendered = text(
            <RunFailureCallout
                text="No ChatGPT connection named 'chatgpt-personal'. Check the agent's model connection."
                stateKey="turn-sub-3"
                code="subscription_connection_missing"
                onRetry={() => undefined}
                onAddKey={noop}
                onSignIn={noop}
            />,
        )

        expect(rendered).toContain("No ChatGPT connection named")
        expect(rendered).not.toContain("Sign in again")
        expect(rendered).not.toContain("Try again")
        expect(rendered).not.toContain("Add your key")
    })

    it("offers Try again when another session already refreshed the sign-in", () => {
        const rendered = text(
            <RunFailureCallout
                text="The ChatGPT sign-in was updated by another session. Try again."
                stateKey="turn-sub-2"
                code="subscription_login_refreshed"
                onRetry={() => undefined}
                onSignIn={noop}
            />,
        )

        expect(rendered).toContain("Try again")
        expect(rendered).not.toContain("Sign in again")
    })

    it("does not offer Try again for a non-transient failure", () => {
        const rendered = text(
            <RunFailureCallout
                text="model authentication failed"
                stateKey="turn-5"
                code="runner_error"
                onRetry={() => undefined}
            />,
        )

        expect(rendered).not.toContain("Try again")
    })
})
