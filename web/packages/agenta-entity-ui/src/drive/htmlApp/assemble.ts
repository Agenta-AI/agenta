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
 *   author's scripts are KEPT (same-folder `<script src>` is inlined, external ones dropped),
 *   and the head gains the CSP, the kit tokens + CSS, and the bridge stub that gives the app
 *   `window.agenta`. No nav interceptor: the stub carries navigation over the port.
 *
 * Both are pure — mount access arrives through {@link AssembleIo}.
 */
import {KIT_TOKENS, RUN_CSP} from "@agenta/entities/drive"

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
export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

/** True when `path` is `dir` itself or sits below it (`dir === ""` is the mount root: everything). */
export const withinDir = (dir: string, path: string): boolean =>
    dir === "" || path === dir || path.startsWith(`${dir}/`)

/** Largest asset folded into the document as a data URI. */
export const INLINE_ASSET_CAP = 8 * 1024 * 1024

/**
 * How the assembler reaches the mount. Paths are mount-relative (already resolved against the
 * HTML file's folder). `null` in a context means "no mount" — a local composer attachment — and
 * skips every asset fetch while the sanitize + interceptor pipeline still runs.
 */
export interface AssembleIo {
    /** Text of a file, or null when it cannot be read. */
    fetchText: (path: string) => Promise<string | null>
    /** `data:` URI of a file (≤ {@link INLINE_ASSET_CAP}), or null when it cannot be read. */
    fetchDataUri: (path: string) => Promise<string | null>
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

/** Inline relative stylesheets/images from the mount into `doc`. Shared by Preview and Run. */
async function inlineAssets(doc: Document, dir: string, io: AssembleIo): Promise<void> {
    await Promise.all(
        Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).map(
            async (link) => {
                const href = link.getAttribute("href") ?? ""
                if (!href || isExternalUrl(href)) return
                const css = await io.fetchText(resolveRel(dir, href))
                if (css == null) return
                const style = doc.createElement("style")
                style.textContent = css
                link.replaceWith(style)
            },
        ),
    )

    await Promise.all(
        Array.from(doc.querySelectorAll<HTMLImageElement>("img[src]")).map(async (img) => {
            const src = img.getAttribute("src") ?? ""
            if (!src || isExternalUrl(src) || src.startsWith("data:")) return
            const uri = await io.fetchDataUri(resolveRel(dir, src))
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
// relative link click into a `postMessage` the parent uses to open that file in the drive. Anchors
// (#…) and external links fall through to the browser.
export const HTML_NAV_INTERCEPTOR =
    '(function(){document.addEventListener("click",function(e){var el=e.target;while(el&&el.tagName!=="A")el=el.parentElement;if(!el)return;var href=el.getAttribute("href");if(!href||href.charAt(0)==="#")return;if(/^[a-z][a-z0-9+.-]*:/i.test(href)||href.indexOf("//")===0)return;e.preventDefault();parent.postMessage({type:"ag-html-nav",href:href},"*")},true)})()'

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
            if (isExternalUrl(a.getAttribute("href") ?? "")) {
                a.setAttribute("target", "_blank")
                a.setAttribute("rel", "noopener noreferrer")
            }
        })
        const interceptor = doc.createElement("script")
        interceptor.textContent = HTML_NAV_INTERCEPTOR
        ;(doc.body ?? doc.documentElement).appendChild(interceptor)

        return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
    } catch {
        return html
    }
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

/**
 * TODO(lane A): replace with `BRIDGE_STUB` from `@agenta/entities/drive` once the real stub lands.
 * Until then the app finds `window.agenta` with a `ready` that rejects (`code: "unavailable"`), so
 * a starter written against the contract shows its own "bridge unavailable" state instead of
 * throwing on an undefined global.
 */
export const PLACEHOLDER_BRIDGE_STUB =
    '(function(){var reject;var ready=new Promise(function(_,r){reject=r});ready.catch(function(){});window.agenta={version:1,ready:ready,canWrite:false,dir:"",visible:true};var e=new Error("agenta bridge stub not installed");e.code="unavailable";reject(e)})()'

/** `:root{--ag-bg:…;…}` for the `<style id="agenta-tokens">` block. Only kit token names pass. */
export const tokensToCss = (tokens: Record<string, string>): string => {
    const names = new Set<string>(KIT_TOKENS)
    const decls = Object.entries(tokens)
        .filter(([name, value]) => names.has(name) && value !== "")
        .map(([name, value]) => `${name}:${value}`)
    return `:root{${decls.join(";")}}`
}

export interface RunContext {
    /** App dir, mount-relative (`""` for the root). Scripts and assets resolve against it. */
    dir: string
    /** Mount access, or null when nothing but the entry text is reachable. */
    io: AssembleIo | null
    /** Kit theme tokens (`--ag-*` → value) for the `agenta-tokens` block. */
    tokens: Record<string, string>
    /** Kit stylesheet; null disables the kit (`manifest.kit === false`). May be `""` until lane E. */
    kitCss: string | null
    /** The bridge stub source; defaults to the lane A placeholder. */
    bridgeStub?: string
}

export interface RunDocument {
    html: string
    /** Human-readable notes about what the assembler had to drop (shown in the error strip). */
    errors: string[]
}

/** A script body can close its own tag when inlined; neutralise the terminator. */
const escapeInlineScript = (text: string): string => text.replace(/<\/script/gi, "<\\/script")

/**
 * The Run document: assets inlined as in Preview, author scripts kept (same-folder `<script src>`
 * inlined through `io`, external ones dropped with a note), then — at the top of `<head>`, in this
 * order — the CSP meta, the kit tokens, the kit CSS (when enabled) and the bridge stub, so the stub
 * runs before any author script. No nav interceptor: the stub posts `nav` over the port.
 */
export async function assembleRunDocument(html: string, ctx: RunContext): Promise<RunDocument> {
    const errors: string[] = []
    try {
        const doc = new DOMParser().parseFromString(html, "text/html")
        const {dir, io} = ctx

        if (io) await inlineAssets(doc, dir, io)

        await Promise.all(
            Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]")).map(
                async (script) => {
                    const src = script.getAttribute("src") ?? ""
                    if (!src || isExternalUrl(src)) {
                        errors.push(
                            `External script dropped by the sandbox: ${src || "(empty src)"}`,
                        )
                        script.remove()
                        return
                    }
                    const path = resolveRel(dir, src)
                    const text = io ? await io.fetchText(path) : null
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
        csp.setAttribute("content", RUN_CSP)

        const tokens = doc.createElement("style")
        tokens.id = "agenta-tokens"
        tokens.textContent = tokensToCss(ctx.tokens)

        const stub = doc.createElement("script")
        stub.textContent = ctx.bridgeStub ?? PLACEHOLDER_BRIDGE_STUB

        const injected: Node[] = [csp, tokens]
        if (ctx.kitCss !== null) {
            const kit = doc.createElement("style")
            kit.id = "agenta-kit"
            kit.textContent = ctx.kitCss
            injected.push(kit)
        }
        injected.push(stub)
        head.prepend(...injected)

        return {html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, errors}
    } catch (error) {
        errors.push(
            `Could not assemble the app document: ${error instanceof Error ? error.message : String(error)}`,
        )
        return {html, errors}
    }
}
