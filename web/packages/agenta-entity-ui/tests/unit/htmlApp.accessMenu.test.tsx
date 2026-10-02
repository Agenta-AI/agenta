/**
 * The ⋯ "File access…" setting: it shows the stored level, offers the full choice (write only where
 * edits are allowed), and a save is stored, which is what reaches a running app.
 */

import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {createGrantStore, type GrantStore} from "../../src/drive/htmlApp/HtmlAppBody"
import {useAppAccessMenu, type AppAccessMenu} from "../../src/drive/htmlApp/useAppAccessMenu"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const render = (grants: GrantStore, canEditMounts = true) => {
    const latest: {menu?: AppAccessMenu} = {}
    const Harness = () => {
        const menu = useAppAccessMenu({
            mountId: "m1",
            dir: "apps/board",
            displayDir: "apps/board",
            appName: "Board",
            env: {grants, canEditMounts},
        })
        latest.menu = menu
        return <>{menu.dialog}</>
    }
    act(() => root.render(<Harness />))
    return latest
}

const radios = () =>
    [...document.querySelectorAll("[role=dialog] [role=radio]")].map((el) =>
        el.getAttribute("value"),
    )

const click = (el: Element | null | undefined) =>
    act(() => {
        el?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })

const button = (label: string) =>
    [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent === label)

describe("File access setting", () => {
    it("labels the stored level and follows changes", () => {
        const grants = createGrantStore()
        const latest = render(grants)
        expect(latest.menu?.label).toBe("Not set")
        act(() => grants.set("m1", "apps/board", {level: "read-write", writeRefused: false}))
        expect(latest.menu?.label).toBe("Read and write")
    })

    it("downgrades to read and remembers it as a refused write", () => {
        const grants = createGrantStore()
        grants.set("m1", "apps/board", {level: "read-write", writeRefused: false})
        const latest = render(grants)
        act(() => latest.menu?.open())
        expect(radios()).toEqual(["read", "read-write", "none"])
        click(document.querySelector('[role=dialog] [role=radio][value="read"]'))
        click(button("Save"))
        expect(grants.get("m1", "apps/board")).toEqual({level: "read", writeRefused: true})
        expect(latest.menu?.label).toBe("Read")
    })

    it("revokes to none", () => {
        const grants = createGrantStore()
        grants.set("m1", "apps/board", {level: "read", writeRefused: false})
        const latest = render(grants)
        act(() => latest.menu?.open())
        click(document.querySelector('[role=dialog] [role=radio][value="none"]'))
        click(button("Save"))
        expect(grants.get("m1", "apps/board")?.level).toBe("none")
    })

    it("offers only Read and None where edits are off", () => {
        const latest = render(createGrantStore(), false)
        act(() => latest.menu?.open())
        expect(radios()).toEqual(["read", "none"])
    })
})
