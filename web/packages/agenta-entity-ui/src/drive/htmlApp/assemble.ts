/**
 * Assembles the documents the HTML viewer's iframe renders.
 *
 * - `assemblePreview` is the Preview tab: it folds a multi-file site into ONE self-contained
 *   document (linked stylesheets → inline `<style>`, images → data URIs, all fetched from the SAME
 *   mount and resolved against the HTML file's folder), then hardens it for
 *   `sandbox="allow-scripts"` — the agent's scripts, inline `on*` handlers and `javascript:` URLs
 *   are stripped so ONLY {@link HTML_NAV_INTERCEPTOR} runs. Lifted verbatim out of
 *   `renderers.tsx`; the lock is `tests/unit/htmlApp.assemble.test.ts`.
 * - `assembleRunDocument` is the Run tab (agent HTML apps): the same asset inlining, but the
 *   author's scripts are KEPT (same-folder `<script src>` is inlined, `https:` ones load as-is),
 *   and the head gains the CSP, the kit tokens + CSS, and the bridge stub that gives the app
 *   `window.agenta`. No nav interceptor: the stub carries navigation over the port.
 *
 * Both are pure — mount access arrives through {@link AssembleIo}.
 */
import {BRIDGE_STUB, PREVIEW_CSP, RUN_CSP} from "@agenta/entities/drive"

import {tokensToCss} from "./kit"

/** A URL the iframe would resolve against ITS OWN origin (external / absolute / anchor / data) —
 * we leave those alone. Only same-mount relative paths get inlined. */
export const isExternalUrl = (u: string): boolean =>
    /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//") || u.startsWith("#")

/** Resolve a relative href against the HTML file's folder (handles `./` and `../`). */
export const resolveRel = (dir: string, rel: string): string => {
    const out: string[] = []
    for (const seg of (dir ? dir.split("/") : []).concat(rel.split("/"))) {
        if (seg === "" || seg === ".") continue
        if (seg === "..") out.pop()
        else out.push(seg)
    }
    return out.join("/")
}

/** Folder of a mount-relative path (`""` for a root-level file). */
export const dirOf = (path: string): string =>
    path.includes("/") ? path.split("/").slice(0, -1).join("/") : ""

/** `dir/name`, or just `name` at the root. */
export const joinAppPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

/** True when `path` is `dir` itself or sits below it (`dir === ""` is the mount root: everything). */
export const withinDir = (dir: string, path: string): boolean =>
    dir === "" || path === dir || path.startsWith(`${dir}/`)

/** Largest asset folded into the document as a data URI. */
export const INLINE_ASSET_CAP = 8 * 1024 * 1024

/** How the assembler reaches files; with `resolve`, references are looked up, not resolved. */
export interface AssembleIo {
    /** Text of a file, or null when it cannot be read. */
    fetchText: (path: string) => Promise<string | null>
    /** `data:` URI of a file (≤ {@link INLINE_ASSET_CAP}), or null when it cannot be read. */
    fetchDataUri: (path: string) => Promise<string | null>
    /** Where `ref`, written in the file `base`, points; null when it points at nothing kept. */
    resolve?: (base: string, ref: string) => string | null
}

/** Read a blob as a `data:` URI; null over the cap or on a reader error. */
export const blobToDataUri = (blob: Blob | null): Promise<string | null> => {
    if (!blob || blob.size > INLINE_ASSET_CAP) return Promise.resolve(null)
    return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
    })
}

/**
 * Options for {@link inlineAssets}.
 *
 * `confine` is what separates Run from Preview. Preview renders ANY html file in the drive, where
 * `../assets/site.css` is an ordinary thing to write and the reader could open that file directly
 * anyway, so it resolves freely. Run happens under a grant the person gave for ONE folder, so a
 * reference that climbs out of it is refused: `resolveRel` pops `..` with no floor, and without
 * this an app could pull any text file in the mount into a `<style>` (or execute it as a script)
 * and then write what it read back into its own folder. The `fs` bridge has always refused those
 * paths; markup went around it.
 */
interface InlineOptions {
    /** App dir every reference must stay inside. Omitted: resolve anywhere in the mount. */
    confine?: string
    /** Sink for references dropped by `confine`, surfaced in the Run tab's error strip. */
    errors?: string[]
    /** The document's own key, the base `io.resolve` resolves its references against. */
    page?: string
}

type RefKind = "Stylesheet" | "Image" | "Script" | "Font or image"

/** Nested `@import` chains stop here, so a stylesheet importing itself cannot loop. */
const MAX_CSS_DEPTH = 4

const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi
const CSS_IMPORT_RE =
    /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi

/** Where a reference is written: its file's key (`io.resolve`) and that file's folder (the mount). */
interface RefBase {
    key: string
    dir: string
}

/** A reference's key: `null` drops it, `undefined` leaves it as written. */
function referenceKey(
    ref: string,
    base: RefBase,
    kind: RefKind,
    io: AssembleIo,
    opts: InlineOptions,
): string | null | undefined {
    if (!ref || ref.startsWith("data:") || ref.startsWith("#")) return undefined
    if (io.resolve) {
        const key = io.resolve(base.key, ref)
        if (key === null) opts.errors?.push(`${kind} not in the shared snapshot: ${ref}`)
        return key
    }
    if (isExternalUrl(ref)) return undefined
    const path = resolveRel(base.dir, ref.split(/[?#]/)[0])
    if (opts.confine !== undefined && !withinDir(opts.confine, path)) {
        opts.errors?.push(`${kind} outside the app folder was not loaded: ${ref}`)
        return null
    }
    return path
}

/** Inline a stylesheet's `url()` and `@import` targets, resolved against its own location. */
/** The base of a fetched stylesheet: its own key, and its folder when it is a mount path. */
const baseOf = (key: string): RefBase => ({key, dir: dirOf(key)})

async function inlineCss(
    css: string,
    base: RefBase,
    io: AssembleIo,
    opts: InlineOptions,
    depth = 0,
): Promise<string> {
    const imports: Array<{match: string; text: string}> = []
    for (const match of css.matchAll(CSS_IMPORT_RE)) {
        const ref = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ""
        const media = match[6]?.trim()
        const key = depth < MAX_CSS_DEPTH ? referenceKey(ref, base, "Stylesheet", io, opts) : null
        if (key === undefined) continue
        const text = key === null ? null : await io.fetchText(key)
        const inner = key && text != null ? await inlineCss(text, baseOf(key), io, opts, depth + 1) : ""
        imports.push({match: match[0], text: media && inner ? `@media ${media}{${inner}}` : inner})
    }
    let out = css
    for (const {match, text} of imports) out = out.replace(match, text)

    const urls = new Map<string, string | null>()
    for (const match of out.matchAll(CSS_URL_RE)) {
        const ref = match[1] ?? match[2] ?? match[3] ?? ""
        if (urls.has(match[0])) continue
        const key = referenceKey(ref, base, "Font or image", io, opts)
        if (key === undefined) continue
        urls.set(match[0], key === null ? null : await io.fetchDataUri(key))
    }
    for (const [match, uri] of urls) {
        out = out.split(match).join(uri ? `url("${uri}")` : "none")
    }
    return out
}

/** Inline a document's stylesheets, `<style>` blocks, `style=""` attributes and images. */
async function inlineAssets(
    doc: Document,
    dir: string,
    io: AssembleIo,
    opts: InlineOptions = {},
): Promise<void> {
    const page: RefBase = {key: opts.page ?? "", dir}

    await Promise.all(
        Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).map(
            async (link) => {
                const key = referenceKey(link.getAttribute("href") ?? "", page, "Stylesheet", io, opts)
                if (key === undefined) return
                if (key === null) {
                    link.remove()
                    return
                }
                const css = await io.fetchText(key)
                if (css == null) return
                const style = doc.createElement("style")
                style.textContent = await inlineCss(css, baseOf(key), io, opts)
                link.replaceWith(style)
            },
        ),
    )

    await Promise.all(
        Array.from(doc.querySelectorAll<HTMLStyleElement>("style")).map(async (style) => {
            const css = style.textContent ?? ""
            if (css.includes("url(") || css.includes("@import")) {
                style.textContent = await inlineCss(css, page, io, opts)
            }
        }),
    )

    await Promise.all(
        Array.from(doc.querySelectorAll<HTMLElement>("[style]")).map(async (el) => {
            const css = el.getAttribute("style") ?? ""
            if (css.includes("url(")) el.setAttribute("style", await inlineCss(css, page, io, opts))
        }),
    )

    await Promise.all(
        Array.from(doc.querySelectorAll<HTMLImageElement>("img[src]")).map(async (img) => {
            const key = referenceKey(img.getAttribute("src") ?? "", page, "Image", io, opts)
            if (key === undefined) return
            if (key === null) {
                img.removeAttribute("src")
                return
            }
            const uri = await io.fetchDataUri(key)
            if (uri) img.setAttribute("src", uri)
        }),
    )
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

export interface PreviewContext {
    /** Folder of the HTML file, mount-relative (`""` for the root). */
    dir: string
    /** Mount access, or null for a local (mount-less) document. */
    io: AssembleIo | null
}

// The ONLY script that runs in the preview (the agent's are stripped): it turns an internal
// relative link click into a `postMessage` the parent uses to open that file in the drive, and
// external links fall through to the browser (a new tab). Anchors (#…) become a hash change on the
// document itself: a srcdoc document resolves `#x` against the PARENT app's URL, so left to the
// browser the click navigated to the app instead of scrolling.
export const HTML_NAV_INTERCEPTOR =
    '(function(){document.addEventListener("click",function(e){var el=e.target;while(el&&el.tagName!=="A")el=el.parentElement;if(!el)return;var href=el.getAttribute("href");if(!href)return;if(href.charAt(0)==="#"){e.preventDefault();location.hash=href;return}if(/^[a-z][a-z0-9+.-]*:/i.test(href)||href.indexOf("//")===0)return;e.preventDefault();parent.postMessage({type:"ag-html-nav",href:href},"*")},true)})()'

/**
 * Fold a multi-file site into ONE self-contained document the sandboxed iframe can render: linked
 * stylesheets become inline `<style>`, images become data URIs — all fetched from the SAME mount,
 * resolved against the HTML file's folder. Best-effort: external URLs are left alone, and CSS's own
 * `url(...)`/`@import` chains aren't followed (v1).
 *
 * Then hardened for `sandbox="allow-scripts"`: the agent's `<script>`s, inline `on*` handlers, and
 * `javascript:` URLs are stripped so ONLY {@link HTML_NAV_INTERCEPTOR} runs; external links open in a
 * new tab; internal links are intercepted and routed to the drive.
 */
export async function assemblePreview(html: string, {dir, io}: PreviewContext): Promise<string> {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html")

        // Skipped for a LOCAL preview (a composer attachment has no mount) — the sanitize +
        // interceptor pipeline below still runs, so the Preview tab assembles instead of loading
        // forever.
        if (io) await inlineAssets(doc, dir, io)

        // Strip every agent-authored script vector so allow-scripts only runs our interceptor.
        doc.querySelectorAll("script").forEach((s) => s.remove())
        doc.querySelectorAll("iframe[srcdoc]").forEach((f) => f.removeAttribute("srcdoc"))
        doc.querySelectorAll("*").forEach((el) => {
            for (const attr of Array.from(el.attributes)) {
                if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
                else if (/^\s*javascript:/i.test(attr.value)) el.setAttribute(attr.name, "#")
            }
        })
        doc.querySelectorAll("a[href]").forEach((a) => {
            const href = a.getAttribute("href") ?? ""
            // Anchors stay in the document (the interceptor scrolls); a new tab would resolve
            // `#x` against the app's URL and reload the whole app there.
            if (isExternalUrl(href) && !href.startsWith("#")) {
                a.setAttribute("target", "_blank")
                a.setAttribute("rel", "noopener noreferrer")
            }
        })
        // First child of <head>, because a policy only governs what the parser meets after it —
        // a nested browsing context declared earlier in the document would load unpoliced.
        const csp = doc.createElement("meta")
        csp.setAttribute("http-equiv", "Content-Security-Policy")
        csp.setAttribute("content", PREVIEW_CSP)
        const head =
            doc.head ??
            doc.documentElement.insertBefore(
                doc.createElement("head"),
                doc.documentElement.firstChild,
            )
        head.insertBefore(csp, head.firstChild)

        const interceptor = doc.createElement("script")
        interceptor.textContent = HTML_NAV_INTERCEPTOR
        ;(doc.body ?? doc.documentElement).appendChild(interceptor)

        return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
    } catch {
        return errorDocument(PREVIEW_CSP, "This file could not be prepared for preview.")
    }
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

export interface RunContext {
    /** App dir, mount-relative (`""` for the root). Scripts and assets resolve against it. */
    dir: string
    /** Mount access, or null when nothing but the entry text is reachable. */
    io: AssembleIo | null
    /** Kit theme tokens (`--ag-*` → value) for the `agenta-tokens` block. */
    tokens: Record<string, string>
    /** Kit stylesheet; null disables the kit (`manifest.kit === false`). */
    kitCss: string | null
    /** The bridge stub source; defaults to `BRIDGE_STUB` (tests and stories may inject another). */
    bridgeStub?: string
    /** Document title when the app has none (the manifest name, else the file name) — axe flags a
     * missing `<title>`, and so does a missing `lang`; both are stamped only when absent. */
    title?: string
    /** The page's own key (`io.resolve` base); defaults to a file in `dir`. */
    page?: string
    /** The policy the document runs under; default {@link RUN_CSP}. A shared app uses `SHARE_CSP`. */
    csp?: string
}

export interface RunDocument {
    html: string
    /** Human-readable notes about what the assembler had to drop (shown in the error strip). */
    errors: string[]
}

const escapeHtml = (text: string): string =>
    text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * What the frame shows when a document cannot be built: the error, under the same policy. The
 * original HTML is never the fallback, because it would render without its policy.
 */
export const errorDocument = (csp: string, message: string): string =>
    `<!DOCTYPE html>\n<html lang="en"><head><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><title>Could not open this file</title></head><body style="font:14px system-ui,sans-serif;padding:16px;color:#555">${escapeHtml(message)}</body></html>`

/** A script body can close its own tag when inlined; neutralise the terminator. */
const escapeInlineScript = (text: string): string => text.replace(/<\/script/gi, "<\\/script")

/**
 * The Run document: assets inlined as in Preview, author scripts kept (same-folder `<script src>`
 * inlined through `io`, `https:` ones left for the browser to load under {@link RUN_CSP}, any other
 * scheme dropped with a note), then — at the top of `<head>`, in this
 * order — the CSP meta, the kit tokens, the kit CSS (when enabled) and the bridge stub, so the stub
 * runs before any author script. No nav interceptor: the stub posts `nav` over the port.
 */
export async function assembleRunDocument(html: string, ctx: RunContext): Promise<RunDocument> {
    const errors: string[] = []
    try {
        const doc = new DOMParser().parseFromString(html, "text/html")
        const {dir, io} = ctx

        const opts: InlineOptions = {confine: dir, errors, page: ctx.page}
        if (io) await inlineAssets(doc, dir, io, opts)

        await Promise.all(
            Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]")).map(
                async (script) => {
                    const src = script.getAttribute("src") ?? ""
                    // Without a snapshot, remote scripts load as-is: RUN_CSP allows `https:`.
                    // Protocol-relative URLs resolve against the host page, served over https.
                    if (!io?.resolve && (/^https:\/\//i.test(src) || src.startsWith("//"))) return
                    if (!src || (!io?.resolve && isExternalUrl(src))) {
                        errors.push(
                            `Script not loaded, only https:// scripts can run: ${src || "(empty src)"}`,
                        )
                        script.remove()
                        return
                    }
                    // The grant is for this folder: a script that climbs out of it is refused
                    // before it is fetched, never mind executed.
                    const key = io
                        ? referenceKey(src, {key: ctx.page ?? "", dir}, "Script", io, opts)
                        : undefined
                    if (key === null) {
                        script.remove()
                        return
                    }
                    const text = io && key ? await io.fetchText(key) : null
                    if (text == null) {
                        errors.push(`Script not found in the app folder: ${src}`)
                        script.remove()
                        return
                    }
                    script.removeAttribute("src")
                    script.textContent = escapeInlineScript(text)
                },
            ),
        )

        const head =
            doc.head ?? doc.documentElement.insertBefore(doc.createElement("head"), doc.body)

        const csp = doc.createElement("meta")
        csp.setAttribute("http-equiv", "Content-Security-Policy")
        csp.setAttribute("content", ctx.csp ?? RUN_CSP)

        const tokens = doc.createElement("style")
        tokens.id = "agenta-tokens"
        tokens.textContent = tokensToCss(ctx.tokens)

        const stub = doc.createElement("script")
        stub.textContent = ctx.bridgeStub ?? BRIDGE_STUB

        const injected: Node[] = [csp, tokens]
        if (ctx.kitCss !== null) {
            const kit = doc.createElement("style")
            kit.id = "agenta-kit"
            kit.textContent = ctx.kitCss
            injected.push(kit)
        }
        injected.push(stub)
        head.prepend(...injected)

        // Accessibility floor the author may have skipped: a document language and a title.
        if (!doc.documentElement.getAttribute("lang"))
            doc.documentElement.setAttribute("lang", "en")
        if (!head.querySelector("title") && ctx.title) {
            const title = doc.createElement("title")
            title.textContent = ctx.title
            head.appendChild(title)
        }

        return {html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, errors}
    } catch (error) {
        const message = `Could not assemble the app document: ${error instanceof Error ? error.message : String(error)}`
        errors.push(message)
        return {html: errorDocument(ctx.csp ?? RUN_CSP, message), errors}
    }
}
