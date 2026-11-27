/**
 * The transfer confirm of a private agent: the dialog's one description holds both warnings,
 * so a screen reader announces what happens to the agent and to the person's chats.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentTransferForm} from "../../src/sharing/AgentTransferForm"

import {byText, click, findByText} from "./domHelpers"

// The picker stands in for itself: one button picks Alice.
vi.mock("@agenta/sessions-ui/sharing", async (importOriginal) => {
    const {createElement: h} = await import("react")
    return {
        ...(await importOriginal<object>()),
        MemberPicker: ({onPick}: {onPick: (member: Record<string, string>) => void}) =>
            h(
                "button",
                {onClick: () => onPick({user_id: "u2", username: "Alice", email: "a@x.io"})},
                "pick Alice",
            ),
    }
})

let root: Root
let host: HTMLDivElement

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

const openConfirm = async (isPrivate: boolean) => {
    await act(async () =>
        root.render(
            createElement(AgentTransferForm, {
                isPrivate,
                members: [],
                membersSearch: "",
                onMembersSearch: () => undefined,
                onTransfer: async () => "ok" as const,
                onCancel: () => undefined,
            }),
        ),
    )
    await click(byText("pick Alice"))
    await click(byText("Transfer"))
    return findByText("", "[role='alertdialog']")
}

const description = (dialog: HTMLElement) => {
    const ids = (dialog.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean)
    return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")
}

describe("AgentTransferForm confirm", () => {
    it("describes a private agent's transfer with both warnings, under one id", async () => {
        const dialog = await openConfirm(true)
        expect(dialog.querySelectorAll("[data-slot='alert-dialog-description']")).toHaveLength(1)
        expect(description(dialog)).toContain("You cannot undo this yourself.")
        expect(description(dialog)).toContain("Your chats with this agent stay yours.")
    })

    it("keeps one warning for a shared agent", async () => {
        const dialog = await openConfirm(false)
        expect(dialog.querySelectorAll("[data-slot='alert-dialog-description']")).toHaveLength(1)
        expect(description(dialog)).not.toContain("Your chats with this agent stay yours.")
    })
})
