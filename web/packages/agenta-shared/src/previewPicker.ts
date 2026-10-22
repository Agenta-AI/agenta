/**
 * Preview comment picker. `installPreviewPicker` ships as a string into sandboxed frames, so its
 * body follows the HTML stub's rules: self-contained ES2017, no spread, no `?.`/`??`.
 */
import {QUOTE_EXCERPT_CAP} from "./quotes"

// Old-style loops on purpose: the picker body is shipped as a string into a foreign document.
/* eslint-disable no-var, @typescript-eslint/prefer-for-of */

export type PickerFormat = "html" | "document" | "presentation"

export interface PickerRect {
    top: number
    left: number
    width: number
    height: number
}

export interface PickedElement {
    selector: string
    tag: string
    page?: number
    openTag?: string
    point: {x: number; y: number}
}

export interface PinQuery {
    id: string
    selector: string
    text: string
}

export type HostToPicker =
    | {type: "pick-start"; format: PickerFormat; page?: number}
    | {type: "pick-stop"}
    | {type: "pins"; pins: PinQuery[]}

export type PickerToHost =
    | {type: "picked"; element: PickedElement; text: string; rect: PickerRect}
    | {type: "pick-cancel"}
    | {type: "pin-rects"; rects: {id: string; rect: PickerRect | null}[]}

export const PICKER_SELECTOR_CAP = 500
export const PICKER_OPEN_TAG_CAP = 300
export const PICKER_TEXT_CAP = QUOTE_EXCERPT_CAP
export const PICKER_TAG_CAP = 40
export const PICKER_ID_CAP = 100
export const PICKER_PIN_RECTS_CAP = 200

const HOST_TO_PICKER_TYPES: readonly string[] = ["pick-start", "pick-stop", "pins"]

export const isHostToPickerType = (type: unknown): boolean =>
    typeof type === "string" && HOST_TO_PICKER_TYPES.indexOf(type) !== -1

interface PickTarget {
    el: Element
    selector: string
    tag: string
    page: number | null
    slide: boolean
}

interface PickerMode {
    format: PickerFormat
    page: number | null
}

interface PickerInbound {
    type?: unknown
    format?: unknown
    page?: unknown
    pins?: unknown
}

export function installPreviewPicker(
    post: (message: PickerToHost) => void,
): (message: unknown) => void {
    var SELECTOR_CAP = 500
    var OPEN_TAG_CAP = 300
    var TEXT_CAP = 2000
    var MAX_STEPS = 12
    var PIN_PREFIX = 80
    var INLINE_TAGS = "|span|b|i|em|strong|small|code|mark|u|s|sub|sup|"
    var BLOCKED = [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "touchstart",
        "touchend",
        "click",
        "dblclick",
        "auxclick",
        "contextmenu",
    ]

    var mode: PickerMode | null = null
    var pins: PinQuery[] = []
    var highlight: HTMLElement | null = null
    var scheduled = false
    var observer: MutationObserver | null = null

    function tidy(value: string | null): string {
        return (value || "").replace(/\s+/g, " ").trim()
    }

    function toElement(node: EventTarget | null): Element | null {
        var n = node as Node | null
        if (!n) return null
        if (n.nodeType === 1) return n as Element
        return n.parentElement
    }

    function slideRoot(): Element | null {
        return document.querySelector("#root > * > *")
    }

    function uniqueId(el: Element): string | null {
        var id = el.getAttribute("id")
        if (!id || typeof CSS === "undefined" || !CSS || typeof CSS.escape !== "function") {
            return null
        }
        var sel = "#" + CSS.escape(id)
        try {
            if (document.querySelectorAll(sel).length === 1) return sel
        } catch (e) {
            return null
        }
        return null
    }

    function nthOfType(el: Element): string {
        var n = 1
        var sib = el.previousElementSibling
        while (sib) {
            if (sib.tagName === el.tagName) n++
            sib = sib.previousElementSibling
        }
        return el.tagName.toLowerCase() + ":nth-of-type(" + n + ")"
    }

    function cssPath(el: Element): string {
        var own = uniqueId(el)
        if (own) return own
        var steps: string[] = []
        var prefix = ""
        var node: Element | null = el
        while (node && node !== document.body && node !== document.documentElement) {
            var anchor = node === el ? null : uniqueId(node)
            if (anchor) {
                prefix = anchor + " > "
                break
            }
            steps.unshift(nthOfType(node))
            node = node.parentElement
        }
        if (steps.length > MAX_STEPS) {
            steps = steps.slice(steps.length - MAX_STEPS)
            prefix = ""
        }
        var out = prefix + steps.join(" > ")
        while (out.length > SELECTOR_CAP && steps.length > 1) {
            steps.shift()
            prefix = ""
            out = steps.join(" > ")
        }
        return out.slice(0, SELECTOR_CAP)
    }

    function pickHtml(target: Element): PickTarget | null {
        var el: Element = target
        while (
            INLINE_TAGS.indexOf("|" + el.tagName.toLowerCase() + "|") !== -1 &&
            el.parentElement &&
            el.parentElement !== document.body &&
            el.parentElement !== document.documentElement
        ) {
            el = el.parentElement
        }
        if (el === document.body || el === document.documentElement) return null
        return {
            el: el,
            selector: cssPath(el),
            tag: el.tagName.toLowerCase(),
            page: null,
            slide: false,
        }
    }

    function pickDocument(target: Element): PickTarget | null {
        var el = target.closest("p, table, img")
        if (!el) return null
        var section = el.closest("section.docx")
        if (!section) return null
        var sections = document.querySelectorAll("section.docx")
        var page = 0
        for (var i = 0; i < sections.length; i++) {
            if (sections[i] === section) page = i + 1
        }
        if (!page) return null
        return {
            el: el,
            selector: cssPath(el),
            tag: el.tagName.toLowerCase(),
            page: page,
            slide: false,
        }
    }

    function pickPresentation(target: Element, page: number | null): PickTarget | null {
        var root = slideRoot()
        if (!root || !root.contains(target)) return null
        var whole = {el: root, selector: ":scope", tag: "slide", page: page, slide: true}
        if (target === root) return whole
        var child: Element = target
        while (child.parentElement && child.parentElement !== root) child = child.parentElement
        if (
            child.hasAttribute("data-pptx-background-image") ||
            child.hasAttribute("data-pptx-background-gradient")
        ) {
            return whole
        }
        var n = 1
        var sib = child.previousElementSibling
        while (sib) {
            n++
            sib = sib.previousElementSibling
        }
        return {
            el: child,
            selector: ":scope > :nth-child(" + n + ")",
            tag: child.tagName.toLowerCase(),
            page: page,
            slide: false,
        }
    }

    function pickable(node: EventTarget | null): PickTarget | null {
        var target = toElement(node)
        if (!mode || !target) return null
        if (mode.format === "html") return pickHtml(target)
        if (mode.format === "document") return pickDocument(target)
        return pickPresentation(target, mode.page)
    }

    function rectOf(el: Element): PickerRect {
        var r = el.getBoundingClientRect()
        return {top: r.top, left: r.left, width: r.width, height: r.height}
    }

    function ratio(offset: number, size: number): number {
        if (!(size > 0)) return 0.5
        var v = offset / size
        return v < 0 ? 0 : v > 1 ? 1 : v
    }

    function removeHighlight(): void {
        if (highlight && highlight.parentNode) highlight.parentNode.removeChild(highlight)
        highlight = null
    }

    function showHighlight(el: Element): void {
        if (!highlight) {
            highlight = document.createElement("div")
            highlight.setAttribute("data-agenta-picker", "highlight")
            var s = highlight.style
            s.position = "fixed"
            s.pointerEvents = "none"
            s.zIndex = "2147483647"
            s.outline = "2px solid rgba(22, 119, 255, 0.9)"
            s.background = "rgba(22, 119, 255, 0.08)"
            s.boxSizing = "border-box"
            s.margin = "0"
            document.documentElement.appendChild(highlight)
        }
        var r = rectOf(el)
        highlight.style.top = r.top + "px"
        highlight.style.left = r.left + "px"
        highlight.style.width = r.width + "px"
        highlight.style.height = r.height + "px"
    }

    function pick(event: MouseEvent): void {
        var found = pickable(event.target)
        if (!found || !mode) return
        var rect = rectOf(found.el)
        var element: PickedElement = {
            selector: found.selector,
            tag: found.tag,
            point: {
                x: ratio(event.clientX - rect.left, rect.width),
                y: ratio(event.clientY - rect.top, rect.height),
            },
        }
        if (found.page !== null) element.page = found.page
        if (mode.format === "html") {
            var outer = found.el.outerHTML
            var end = outer.indexOf(">")
            element.openTag = (end === -1 ? outer : outer.slice(0, end + 1)).slice(0, OPEN_TAG_CAP)
        }
        var text = found.slide ? "" : tidy(found.el.textContent).slice(0, TEXT_CAP)
        post({type: "picked", element: element, text: text, rect: rect})
    }

    function onBlocked(event: Event): void {
        if (!mode) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        if (event.type === "click") pick(event as MouseEvent)
    }

    function onHover(event: Event): void {
        if (!mode) return
        var found = pickable(event.target)
        if (found) showHighlight(found.el)
        else removeHighlight()
    }

    function onKey(event: KeyboardEvent): void {
        if (!mode || event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        mode = null
        removeHighlight()
        post({type: "pick-cancel"})
    }

    function resolvePin(pin: PinQuery): Element | null {
        var root = slideRoot()
        var el: Element | null = null
        try {
            if (pin.selector === ":scope") el = root
            else if (pin.selector.indexOf(":scope") === 0)
                el = root ? root.querySelector(pin.selector) : null
            else el = document.querySelector(pin.selector)
        } catch (e) {
            el = null
        }
        var stored = tidy(pin.text)
        var prefix = stored.slice(0, PIN_PREFIX)
        if (el && tidy(el.textContent).indexOf(prefix) === 0) return el
        if (!stored) return null
        var lastStep = pin.selector.split(">").pop() || ""
        var tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(lastStep.trim())
        var candidates =
            pin.selector.indexOf(":scope") === 0
                ? root
                    ? root.children
                    : []
                : document.querySelectorAll(tagMatch ? tagMatch[1] : "*")
        var exact: Element | null = null
        var first: Element | null = null
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i]
            if (c === document.documentElement || c === document.body || c === document.head)
                continue
            var t = tidy(c.textContent)
            if (!exact && t.slice(0, TEXT_CAP) === stored) exact = c
            if (!first && t.indexOf(prefix) === 0) first = c
            if (exact) break
        }
        return exact || first
    }

    function postPinRects(): void {
        var rects: {id: string; rect: PickerRect | null}[] = []
        for (var i = 0; i < pins.length; i++) {
            var el = resolvePin(pins[i])
            rects.push({id: pins[i].id, rect: el ? rectOf(el) : null})
        }
        post({type: "pin-rects", rects: rects})
    }

    function schedule(): void {
        if (scheduled || pins.length === 0) return
        scheduled = true
        var run = function () {
            scheduled = false
            if (pins.length > 0) postPinRects()
        }
        if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run)
        else setTimeout(run, 16)
    }

    function ensureObserver(): void {
        if (observer || !document.body || typeof MutationObserver === "undefined") return
        observer = new MutationObserver(schedule)
        observer.observe(document.body, {childList: true, subtree: true, characterData: true})
    }

    function readPins(value: unknown): PinQuery[] | null {
        if (!Array.isArray(value)) return null
        var out: PinQuery[] = []
        for (var i = 0; i < value.length; i++) {
            var p = value[i] as {id?: unknown; selector?: unknown; text?: unknown} | null
            if (!p || typeof p !== "object") continue
            if (
                typeof p.id !== "string" ||
                typeof p.selector !== "string" ||
                typeof p.text !== "string"
            ) {
                continue
            }
            out.push({id: p.id, selector: p.selector, text: p.text})
        }
        return out
    }

    for (var b = 0; b < BLOCKED.length; b++) window.addEventListener(BLOCKED[b], onBlocked, true)
    window.addEventListener("pointermove", onHover, true)
    window.addEventListener("mouseover", onHover, true)
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("scroll", schedule, true)
    window.addEventListener("resize", schedule)
    if (document.body) ensureObserver()
    else document.addEventListener("DOMContentLoaded", ensureObserver)

    return function handle(message: unknown): void {
        if (!message || typeof message !== "object") return
        var m = message as PickerInbound
        if (m.type === "pick-start") {
            if (m.format !== "html" && m.format !== "document" && m.format !== "presentation")
                return
            var page =
                typeof m.page === "number" && m.page > 0 && Math.floor(m.page) === m.page
                    ? m.page
                    : null
            mode = {format: m.format, page: page}
            ensureObserver()
        } else if (m.type === "pick-stop") {
            mode = null
            removeHighlight()
        } else if (m.type === "pins") {
            var next = readPins(m.pins)
            if (!next) return
            pins = next
            ensureObserver()
            postPinRects()
        }
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const cappedString = (value: unknown, cap: number): string | null =>
    typeof value === "string" && value.length <= cap ? value : null

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value)

const isUnit = (value: unknown): value is number =>
    isFiniteNumber(value) && value >= 0 && value <= 1

const parseRect = (value: unknown): PickerRect | null => {
    if (!isRecord(value)) return null
    const {top, left, width, height} = value
    if (!isFiniteNumber(top) || !isFiniteNumber(left)) return null
    if (!isFiniteNumber(width) || !isFiniteNumber(height) || width < 0 || height < 0) return null
    return {top, left, width, height}
}

const insideFrame = (rect: PickerRect, frame: {width: number; height: number}): boolean =>
    rect.left <= frame.width &&
    rect.left + rect.width >= 0 &&
    rect.top <= frame.height &&
    rect.top + rect.height >= 0

const parsePickedElement = (value: unknown): PickedElement | null => {
    if (!isRecord(value)) return null
    const selector = cappedString(value.selector, PICKER_SELECTOR_CAP)
    const tag = cappedString(value.tag, PICKER_TAG_CAP)
    if (!selector || !tag) return null
    const point = value.point
    if (!isRecord(point) || !isUnit(point.x) || !isUnit(point.y)) return null
    const element: PickedElement = {selector, tag, point: {x: point.x, y: point.y}}
    if (value.page !== undefined) {
        if (!Number.isInteger(value.page) || (value.page as number) < 1) return null
        element.page = value.page as number
    }
    if (value.openTag !== undefined) {
        const openTag = cappedString(value.openTag, PICKER_OPEN_TAG_CAP)
        if (openTag === null) return null
        element.openTag = openTag
    }
    return element
}

/** Validate a picker message from a frame; a pin rect is `null` only when its element is gone. */
export function parsePickerMessage(
    data: unknown,
    frame: {width: number; height: number},
): PickerToHost | null {
    if (!isRecord(data)) return null
    if (data.type === "pick-cancel") return {type: "pick-cancel"}
    if (data.type === "picked") {
        const element = parsePickedElement(data.element)
        const text = cappedString(data.text, PICKER_TEXT_CAP)
        const rect = parseRect(data.rect)
        if (!element || text === null || !rect || !insideFrame(rect, frame)) return null
        return {type: "picked", element, text, rect}
    }
    if (data.type === "pin-rects") {
        if (!Array.isArray(data.rects) || data.rects.length > PICKER_PIN_RECTS_CAP) return null
        const rects: {id: string; rect: PickerRect | null}[] = []
        for (const entry of data.rects) {
            if (!isRecord(entry)) return null
            const id = cappedString(entry.id, PICKER_ID_CAP)
            if (!id) return null
            if (entry.rect === null) {
                rects.push({id, rect: null})
                continue
            }
            const rect = parseRect(entry.rect)
            if (!rect) return null
            rects.push({id, rect})
        }
        return {type: "pin-rects", rects}
    }
    return null
}
