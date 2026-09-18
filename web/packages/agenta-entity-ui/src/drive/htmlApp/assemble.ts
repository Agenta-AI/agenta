/**
 * Assembles the document the HTML viewer's iframe renders.
 *
 * `assemblePreview` is the Preview tab: it folds a multi-file site into ONE self-contained
 * document (linked stylesheets → inline `<style>`, images → data URIs, all fetched from the SAME
 * mount and resolved against the HTML file's folder), then hardens it for
 * `sandbox="allow-scripts"` — the agent's scripts, inline `on*` handlers and `javascript:` URLs
 * are stripped so ONLY {@link HTML_NAV_INTERCEPTOR} runs. Lifted verbatim out of `renderers.tsx`
 * (the lock is `tests/unit/htmlApp.assemble.test.ts`); the mount fetchers arrive through
 * {@link AssembleIo} so the function itself is pure.
 */

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

        // Inline relative stylesheets/images from the mount. Skipped for a LOCAL preview (a composer
        // attachment has no mount) — the sanitize + interceptor pipeline below still runs, so the
        // Preview tab assembles instead of loading forever.
        if (io) {
            await Promise.all(
                Array.from(
                    doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'),
                ).map(async (link) => {
                    const href = link.getAttribute("href") ?? ""
                    if (!href || isExternalUrl(href)) return
                    const css = await io.fetchText(resolveRel(dir, href))
                    if (css == null) return
                    const style = doc.createElement("style")
                    style.textContent = css
                    link.replaceWith(style)
                }),
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
