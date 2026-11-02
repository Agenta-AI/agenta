/** Assembles the self-contained document an HTML app's iframe runs (pure; io via `AssembleIo`). */
import {BRIDGE_STUB, RUN_CSP} from "@agenta/entities/drive"

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

/**
 * How the assembler reaches the mount. Paths are mount-relative (already resolved against the
 * HTML file's folder). `null` in a context means "no mount" and skips every asset fetch.
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

/** `confine`: a grant covers one folder, so a reference that climbs out of it is refused. */
interface InlineOptions {
    /** App dir every reference must stay inside. */
    confine: string
    /** Sink for references dropped by `confine`, surfaced in the Run tab's error strip. */
    errors?: string[]
}

/** Inline relative stylesheets/images from the mount into `doc`. */
async function inlineAssets(
    doc: Document,
    dir: string,
    io: AssembleIo,
    opts: InlineOptions,
): Promise<void> {
    const {confine, errors} = opts

    /** Mount-relative target, or null when it leaves `confine`. */
    const target = (ref: string, kind: string): string | null => {
        const path = resolveRel(dir, ref)
        if (!withinDir(confine, path)) {
            errors?.push(`${kind} outside the app folder was not loaded: ${ref}`)
            return null
        }
        return path
    }

    await Promise.all(
        Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).map(
            async (link) => {
                const href = link.getAttribute("href") ?? ""
                if (!href || isExternalUrl(href)) return
                const path = target(href, "Stylesheet")
                if (path === null) {
                    link.remove()
                    return
                }
                const css = await io.fetchText(path)
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
            const path = target(src, "Image")
            if (path === null) {
                img.removeAttribute("src")
                return
            }
            const uri = await io.fetchDataUri(path)
            if (uri) img.setAttribute("src", uri)
        }),
    )
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
}

export interface RunDocument {
    html: string
    /** Human-readable notes about what the assembler had to drop (shown in the error strip). */
    errors: string[]
}

/** A script body can close its own tag when inlined; neutralise the terminator. */
const escapeInlineScript = (text: string): string => text.replace(/<\/script/gi, "<\\/script")

/**
 * The Run document: same-mount assets inlined, author scripts kept (same-folder `<script src>`
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

        if (io) await inlineAssets(doc, dir, io, {confine: dir, errors})

        await Promise.all(
            Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]")).map(
                async (script) => {
                    const src = script.getAttribute("src") ?? ""
                    // Remote scripts load as-is: RUN_CSP allows `https:`. Protocol-relative URLs
                    // resolve against the host page, which is served over https.
                    if (/^https:\/\//i.test(src) || src.startsWith("//")) return
                    if (!src || isExternalUrl(src)) {
                        errors.push(
                            `Script not loaded, only https:// scripts can run: ${src || "(empty src)"}`,
                        )
                        script.remove()
                        return
                    }
                    const path = resolveRel(dir, src)
                    // The grant is for this folder: a script that climbs out of it is refused
                    // before it is fetched, never mind executed.
                    if (!withinDir(dir, path)) {
                        errors.push(`Script outside the app folder was not loaded: ${src}`)
                        script.remove()
                        return
                    }
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
        errors.push(
            `Could not assemble the app document: ${error instanceof Error ? error.message : String(error)}`,
        )
        return {html, errors}
    }
}
