// @vitest-environment jsdom
/**
 * A refused send has to say why it was refused.
 *
 * The invoke lane answers a refusal with HTTP 422 and a typed envelope. Before this, the send
 * path cancelled that body and threw the status number, so the composer could only say the
 * message had not gone — the reason ("no model provider is configured", and what to do about it)
 * never reached the screen on either app.
 */
import {ComposerRejections} from "@agenta/chat/components"
import {render, screen} from "@testing-library/react"
import {describe, expect, it} from "vitest"

import {PENDING_SEND_FAILED_NOTE} from "../../../src/assets/pendingSendEchoes"
import {
    describeRefusedSend,
    refusedSendRejections,
    readSendRefusal,
    REFUSED_SEND_REASON,
    refusedSendReason,
    SendRefusedError,
} from "../../../src/model/error"

/** The envelope the SDK normalizer answers with, stacktrace and all. */
const sdkEnvelope = (message: string, failureCode?: string) =>
    JSON.stringify({
        session_id: "c0432835345f4ef6b1350ba5a807c5e5",
        trace_id: "2ed3f54e237cece980395e051e7a97ac",
        status: {
            code: 422,
            message,
            type: "https://agenta.ai/docs/errors#v1:sdk:unknown-workflow-invoke-error",
            stacktrace: ["Traceback (most recent call last):\n", "  File ...\n"],
            ...(failureCode ? {failure_code: failureCode} : {}),
        },
    })

const chipFor = (body: string, status = 422) => describeRefusedSend(readSendRefusal(status, body))

describe("readSendRefusal", () => {
    it("states the message from a 422 the SDK normalizer refused with", () => {
        const refusal = readSendRefusal(
            422,
            sdkEnvelope("LLM endpoint not found: custom/absent-gw", "gateway_endpoint_missing"),
        )
        expect(refusal).toBeInstanceOf(SendRefusedError)
        expect(refusal.statedReason).toBe("LLM endpoint not found: custom/absent-gw")
        expect(refusal.refusalCode).toBe("gateway_endpoint_missing")
        expect(refusal.status).toBe(422)
    })

    it("never passes the stacktrace on as the reason", () => {
        expect(refusedSendReason(readSendRefusal(422, sdkEnvelope("Refused.")))).toBe("Refused.")
    })

    it("appends the next step when the refusal named one", () => {
        const body = JSON.stringify({
            detail: {
                code: "secret_missing",
                message: "No project secret for provider:openai.",
                next_step: "Add a model provider on the AI providers page.",
            },
        })
        expect(refusedSendReason(readSendRefusal(422, body))).toBe(
            "No project secret for provider:openai. Add a model provider on the AI providers page.",
        )
    })

    it("reads a plain-string detail and a JSON-RPC refusal the same way", () => {
        expect(
            refusedSendReason(
                readSendRefusal(422, JSON.stringify({detail: "Endpoint is inactive."})),
            ),
        ).toBe("Endpoint is inactive.")
        expect(
            refusedSendReason(
                readSendRefusal(
                    422,
                    JSON.stringify({error: {code: -32001, message: "Tool refused."}}),
                ),
            ),
        ).toBe("Tool refused.")
    })

    it("strips the runner's machine-addressed code marker", () => {
        const body = JSON.stringify({
            detail: {message: "This connection needs authorization. ⟦agenta_code:auth_required⟧"},
        })
        const refusal = readSendRefusal(422, body)
        expect(refusal.statedReason).toBe("This connection needs authorization.")
        expect(refusal.refusalCode).toBe("auth_required")
    })

    it("states nothing when the body carries no message", () => {
        for (const body of [
            "",
            "<!doctype html><html></html>",
            "{}",
            JSON.stringify({status: {code: 422}}),
        ]) {
            expect(refusedSendReason(readSendRefusal(422, body))).toBeNull()
        }
    })
})

describe("describeRefusedSend", () => {
    it("puts the stated reason in the composer's chip", () => {
        expect(chipFor(sdkEnvelope("LLM endpoint not found: custom/absent-gw"))).toBe(
            "wasn't sent — LLM endpoint not found: custom/absent-gw",
        )
    })

    it("keeps the standing wording when the refusal stated nothing", () => {
        expect(chipFor("{}")).toBe(REFUSED_SEND_REASON)
        expect(chipFor("")).toBe(REFUSED_SEND_REASON)
        // A rejection with no refusal behind it at all (an aborted upload, say) reads the same.
        expect(describeRefusedSend(new Error("boom"))).toBe(REFUSED_SEND_REASON)
    })

    it("keeps the failed-row note word for word in step with it", () => {
        expect(PENDING_SEND_FAILED_NOTE).toBe("Message wasn't sent — try again.")
        expect(PENDING_SEND_FAILED_NOTE).toBe(`Message ${REFUSED_SEND_REASON}`)
    })
})

describe("refusedSendRejections", () => {
    // Round-4 D98: both apps put `describeRefusedSend` on the rejection in their composer's
    // catch, and only the mobile call site had a case, so hardcoding the reason on classic left
    // every suite green. The row is built in one place now, and this is the case over it.
    it("carries the refusal's own reason onto the chip's row", () => {
        expect(
            refusedSendRejections(
                readSendRefusal(422, sdkEnvelope("No model provider is configured.")),
            ),
        ).toEqual([{name: "Message", reason: "wasn't sent — No model provider is configured."}])
    })

    it("keeps the standing wording when the refusal stated nothing", () => {
        expect(refusedSendRejections(new Error("boom"))).toEqual([
            {name: "Message", reason: REFUSED_SEND_REASON},
        ])
    })

    it("names the message, not a file, as the subject", () => {
        // The chip is the attachment strip's row type, and every other row in it is a file.
        expect(refusedSendRejections(new Error("boom"))[0].name).toBe("Message")
    })
})

describe("the refusal chip on screen", () => {
    const rejectionFor = (body: string) => [{name: "Message", reason: chipFor(body)}]

    it("renders the refusal's own sentence", () => {
        render(
            <ComposerRejections
                rejections={rejectionFor(sdkEnvelope("No model provider is configured."))}
                onDismiss={() => undefined}
            />,
        )
        expect(screen.getByText("wasn't sent — No model provider is configured.")).toBeTruthy()
    })

    it("renders the generic text when the refusal stated nothing", () => {
        render(<ComposerRejections rejections={rejectionFor("{}")} onDismiss={() => undefined} />)
        expect(screen.getByText(REFUSED_SEND_REASON)).toBeTruthy()
    })
})
