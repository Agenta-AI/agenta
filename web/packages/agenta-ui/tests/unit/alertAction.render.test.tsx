// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {Alert} from "../../src/components/ui/alert"
import {Button} from "../../src/components/ui/button"

/**
 * The expired-login banner is a message with a control on the same line. Without a slot for it,
 * that control goes inside `message`, where it inherits the title's font weight and wraps under
 * the text as soon as the message is long, which is most of the time on a phone.
 */
afterEach(cleanup)

const alert = () => screen.getByRole("alert")
const actionSlot = () => alert().querySelector("[data-slot=alert-action]")

describe("Alert action slot", () => {
    it("renders the action", () => {
        render(
            <Alert
                type="warning"
                message="Login expired"
                action={<Button size="sm">Reconnect</Button>}
            />,
        )
        expect(screen.getByRole("button", {name: "Reconnect"})).toBeTruthy()
    })

    it("does not wrap: the slot is shrink-0 and the message keeps the flexible width", () => {
        render(<Alert type="warning" message="Login expired" action={<button>Reconnect</button>} />)
        expect(actionSlot()?.className).toContain("shrink-0")
        const content = alert().querySelector("[data-slot=alert-content]")
        expect(content?.className).toContain("flex-1")
        expect(content?.className).toContain("min-w-0")
    })

    it("sits after the message and before the close button", () => {
        render(
            <Alert
                type="warning"
                message="Login expired"
                action={<button>Reconnect</button>}
                closable
            />,
        )
        const slots = Array.from(alert().children).map(
            (el) => (el as HTMLElement).dataset.slot ?? "",
        )
        expect(slots.indexOf("alert-content")).toBeLessThan(slots.indexOf("alert-action"))
        expect(slots.indexOf("alert-action")).toBeLessThan(slots.indexOf("alert-close"))
    })

    it("renders nothing extra when no action is given", () => {
        render(<Alert type="info" message="Plain message" />)
        expect(actionSlot()).toBeNull()
    })

    it("works on a banner, which is the expired-login case", () => {
        render(
            <Alert
                banner
                type="warning"
                message="This server's login expired"
                action={<button>Reconnect</button>}
            />,
        )
        expect(alert().className).toContain("border-0")
        expect(actionSlot()).not.toBeNull()
    })
})
