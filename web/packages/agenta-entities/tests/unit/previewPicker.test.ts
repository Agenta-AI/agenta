// @vitest-environment jsdom
/** The shipped picker string, evaluated in a fresh iframe realm per test like the HTML stub. */
import {installPreviewPicker} from "@agenta/shared/previewPicker"
import type {PickerToHost} from "@agenta/shared/previewPicker"
import {afterEach, describe, expect, it} from "vitest"

interface Realm {
    win: Window & {eval(code: string): unknown}
    doc: Document
    posted: PickerToHost[]
    handle: (message: unknown) => void
}

const frames: HTMLIFrameElement[] = []

const realm = (body: string, withCssEscape = true): Realm => {
    const frame = document.createElement("iframe")
    document.body.appendChild(frame)
    frames.push(frame)
    const win = frame.contentWindow as Realm["win"]
    win.document.body.innerHTML = body
    if (withCssEscape) win.eval("window.CSS = {escape: function (s) { return String(s) }}")
    const posted: PickerToHost[] = []
    const host = win as unknown as {__post: (m: PickerToHost) => void}
    host.__post = (m) => posted.push(m)
    const handle = win.eval(
        `(${installPreviewPicker.toString()})(window.__post)`,
    ) as Realm["handle"]
    return {win, doc: win.document, posted, handle}
}

const fire = (r: Realm, el: Element, type: string) =>
    el.dispatchEvent(new r.win.MouseEvent(type, {bubbles: true, cancelable: true}))

/** What a person's click looks like to the picker: a press, then the click. */
const press = (r: Realm, el: Element) => {
    fire(r, el, "mousedown")
    return fire(r, el, "click")
}

const lastPicked = (r: Realm) => {
    const msg = r.posted.filter((m) => m.type === "picked").pop()
    if (!msg || msg.type !== "picked") throw new Error("nothing picked")
    return msg
}

afterEach(() => {
    // Teardown mutations would schedule a frame that runs after the realm is gone.
    for (const frame of frames) {
        const win = frame.contentWindow as Window
        win.requestAnimationFrame = () => 0
    }
    while (frames.length) frames.pop()?.remove()
})

describe("installPreviewPicker: html", () => {
    it("picks the heading past inline tags with its unique id", () => {
        const r = realm(`<h2 id="x"><strong>Hi</strong></h2>`)
        r.handle({type: "pick-start", format: "html"})
        press(r, r.doc.querySelector("strong")!)
        const msg = lastPicked(r)
        expect(msg.element.selector).toBe("#x")
        expect(msg.element.tag).toBe("h2")
        expect(msg.element.openTag).toBe('<h2 id="x">')
        expect(msg.element.page).toBeUndefined()
        expect(msg.element.point).toEqual({x: 0.5, y: 0.5})
        expect(msg.text).toBe("Hi")
    })

    it("builds an nth-of-type path to body when no id is unique", () => {
        const r = realm(`<div><p>a</p></div><div><p>b</p><p>  c <em>d</em>  </p></div>`)
        r.handle({type: "pick-start", format: "html"})
        press(r, r.doc.querySelector("em")!)
        const msg = lastPicked(r)
        expect(msg.element.selector).toBe("div:nth-of-type(2) > p:nth-of-type(2)")
        expect(msg.text).toBe("c d")
        expect(r.doc.querySelector(msg.element.selector)?.textContent).toBe("  c d  ")
    })

    it("anchors the path at the nearest ancestor with a unique id", () => {
        const r = realm(`<section id="s"><ul><li>a</li><li>b</li></ul></section>`)
        r.handle({type: "pick-start", format: "html"})
        press(r, r.doc.querySelectorAll("li")[1])
        expect(lastPicked(r).element.selector).toBe("#s > ul:nth-of-type(1) > li:nth-of-type(2)")
    })

    it("skips ids when CSS.escape is missing", () => {
        const r = realm(`<h2 id="x">Hi</h2>`, false)
        r.handle({type: "pick-start", format: "html"})
        press(r, r.doc.querySelector("h2")!)
        expect(lastPicked(r).element.selector).toBe("h2:nth-of-type(1)")
    })

    it("blocks the app's handlers in comment mode and restores them after pick-stop", () => {
        const r = realm(`<button>Go</button>`)
        const calls: string[] = []
        const button = r.doc.querySelector("button")!
        button.addEventListener("mousedown", () => calls.push("mousedown"))
        button.addEventListener("pointerdown", () => calls.push("pointerdown"))
        button.addEventListener("click", () => calls.push("click"))

        r.handle({type: "pick-start", format: "html"})
        fire(r, button, "pointerdown")
        fire(r, button, "mousedown")
        press(r, button)
        expect(calls).toEqual([])
        expect(lastPicked(r).element.tag).toBe("button")

        r.handle({type: "pick-stop"})
        fire(r, button, "pointerdown")
        fire(r, button, "mousedown")
        fire(r, button, "click")
        expect(calls).toEqual(["pointerdown", "mousedown", "click"])
    })

    it("stops a link click from navigating or propagating", () => {
        const r = realm(`<a href="#elsewhere">Link</a>`)
        const seen: string[] = []
        r.doc.addEventListener("click", () => seen.push("document"))
        r.handle({type: "pick-start", format: "html"})
        const notCancelled = press(r, r.doc.querySelector("a")!)
        expect(notCancelled).toBe(false)
        expect(seen).toEqual([])
        expect(r.win.location.hash).toBe("")
        expect(lastPicked(r).element.tag).toBe("a")
    })

    it("draws the highlight under documentElement and removes it on pick-stop", () => {
        const r = realm(`<p>a</p>`)
        r.handle({type: "pick-start", format: "html"})
        fire(r, r.doc.querySelector("p")!, "mouseover")
        const highlight = r.doc.querySelector("[data-agenta-picker]") as HTMLElement
        expect(highlight.parentElement).toBe(r.doc.documentElement)
        expect(highlight.style.pointerEvents).toBe("none")
        r.handle({type: "pick-stop"})
        expect(r.doc.querySelector("[data-agenta-picker]")).toBeNull()
    })

    it("posts pick-cancel on Escape and leaves comment mode", () => {
        const r = realm(`<button>Go</button>`)
        let clicks = 0
        r.doc.querySelector("button")!.addEventListener("click", () => clicks++)
        r.handle({type: "pick-start", format: "html"})
        r.win.dispatchEvent(new r.win.KeyboardEvent("keydown", {key: "Escape"}))
        expect(r.posted).toEqual([{type: "pick-cancel"}])
        press(r, r.doc.querySelector("button")!)
        expect(clicks).toBe(1)
    })

    it("ignores unknown or malformed host messages", () => {
        const r = realm(`<button>Go</button>`)
        r.handle(null)
        r.handle({type: "pick-start", format: "pdf"})
        r.handle({type: "pins", pins: "nope"})
        press(r, r.doc.querySelector("button")!)
        expect(r.posted).toEqual([])
    })
})

describe("installPreviewPicker: document", () => {
    it("picks the paragraph and reports its section as the page", () => {
        const r = realm(
            `<div class="docx-wrapper"><section class="docx"><p>one</p></section>` +
                `<section class="docx"><p>first</p><p><span>two</span></p></section></div>`,
        )
        r.handle({type: "pick-start", format: "document"})
        press(r, r.doc.querySelector("section:nth-of-type(2) span")!)
        const msg = lastPicked(r)
        expect(msg.element.page).toBe(2)
        expect(msg.element.tag).toBe("p")
        expect(msg.element.selector).toBe(
            "div:nth-of-type(1) > section:nth-of-type(2) > p:nth-of-type(2)",
        )
        expect(msg.element.openTag).toBeUndefined()
        expect(msg.text).toBe("two")
    })

    it("picks nothing outside a docx section", () => {
        const r = realm(`<p>loose</p>`)
        r.handle({type: "pick-start", format: "document"})
        press(r, r.doc.querySelector("p")!)
        expect(r.posted).toEqual([])
    })
})

describe("installPreviewPicker: presentation", () => {
    const slide =
        `<div id="root"><div><div class="slide">` +
        `<div class="shape"><span>Title</span></div>` +
        `<div data-pptx-background-image="1"></div>` +
        `</div></div></div>`

    it("picks the slide root's child that holds the target", () => {
        const r = realm(slide)
        r.handle({type: "pick-start", format: "presentation", page: 3})
        press(r, r.doc.querySelector(".shape span")!)
        const msg = lastPicked(r)
        expect(msg.element).toMatchObject({selector: ":scope > :nth-child(1)", tag: "div", page: 3})
        expect(msg.text).toBe("Title")
    })

    it("resolves a background child to the whole slide", () => {
        const r = realm(slide)
        r.handle({type: "pick-start", format: "presentation", page: 1})
        r.handle({type: "pick-start", format: "presentation", page: 4})
        press(r, r.doc.querySelector("[data-pptx-background-image]")!)
        const msg = lastPicked(r)
        expect(msg.element).toMatchObject({selector: ":scope", tag: "slide", page: 4})
        expect(msg.text).toBe("")
    })

    it("resolves slide pins relative to the slide root", () => {
        const r = realm(slide)
        r.handle({
            type: "pins",
            pins: [
                {id: "s", selector: ":scope", text: ""},
                {id: "t", selector: ":scope > :nth-child(1)", text: "Title"},
            ],
        })
        const zero = {top: 0, left: 0, width: 0, height: 0}
        expect(r.posted).toEqual([
            {
                type: "pin-rects",
                rects: [
                    {id: "s", rect: zero},
                    {id: "t", rect: zero},
                ],
            },
        ])
    })
})

describe("installPreviewPicker: pins", () => {
    const zero = {top: 0, left: 0, width: 0, height: 0}
    const pin = {
        id: "p1",
        selector: "div:nth-of-type(1) > p:nth-of-type(2)",
        text: "Second paragraph",
    }

    it("resolves by selector, then by text after the element moved, then null after the text changed", () => {
        const r = realm(`<div><p>First</p><p>Second paragraph</p></div>`)
        r.handle({type: "pins", pins: [pin]})
        expect(r.posted.pop()).toEqual({type: "pin-rects", rects: [{id: "p1", rect: zero}]})

        const div = r.doc.querySelector("div")!
        const inserted = r.doc.createElement("p")
        inserted.textContent = "Inserted"
        div.insertBefore(inserted, div.firstChild)
        expect(r.doc.querySelector(pin.selector)?.textContent).toBe("First")
        r.handle({type: "pins", pins: [pin]})
        expect(r.posted.pop()).toEqual({type: "pin-rects", rects: [{id: "p1", rect: zero}]})

        r.doc.querySelectorAll("p")[2].textContent = "Rewritten"
        r.handle({type: "pins", pins: [pin]})
        expect(r.posted.pop()).toEqual({type: "pin-rects", rects: [{id: "p1", rect: null}]})
    })

    it("re-posts after a DOM mutation and survives an invalid selector", async () => {
        const r = realm(`<div><p>First</p></div>`)
        r.handle({type: "pins", pins: [{id: "bad", selector: "p[", text: "Nope"}]})
        expect(r.posted).toEqual([{type: "pin-rects", rects: [{id: "bad", rect: null}]}])
        r.doc.querySelector("p")!.textContent = "Nope"
        await new Promise((resolve) => setTimeout(resolve, 40))
        expect(r.posted).toEqual([
            {type: "pin-rects", rects: [{id: "bad", rect: null}]},
            {type: "pin-rects", rects: [{id: "bad", rect: {top: 0, left: 0, width: 0, height: 0}}]},
        ])
    })

    it("keeps a unique-id pin on its element while the element's text changes", () => {
        const r = realm(`<p id="c">count 1</p>`)
        r.doc.querySelector("p")!.textContent = "count 9"
        r.handle({type: "pins", pins: [{id: "live", selector: "#c", text: "count 1"}]})
        expect(r.posted.pop()).toEqual({type: "pin-rects", rects: [{id: "live", rect: zero}]})
        r.doc.querySelector("p")!.remove()
        r.handle({type: "pins", pins: [{id: "live", selector: "#c", text: "count 1"}]})
        expect(r.posted.pop()).toEqual({type: "pin-rects", rects: [{id: "live", rect: null}]})
    })
})

describe("installPreviewPicker: who can pick", () => {
    it("ignores a scripted click with no press before it", () => {
        const r = realm(`<h2>Hostile</h2>`)
        r.handle({type: "pick-start", format: "html"})
        fire(r, r.doc.querySelector("h2")!, "click")
        expect(r.posted).toEqual([])
        press(r, r.doc.querySelector("h2")!)
        expect(lastPicked(r).element.tag).toBe("h2")
    })

    it("ignores a click whose press landed on another element", () => {
        const r = realm(`<h2>One</h2><p>Two</p>`)
        r.handle({type: "pick-start", format: "html"})
        fire(r, r.doc.querySelector("h2")!, "mousedown")
        fire(r, r.doc.querySelector("p")!, "click")
        expect(r.posted).toEqual([])
    })
})
