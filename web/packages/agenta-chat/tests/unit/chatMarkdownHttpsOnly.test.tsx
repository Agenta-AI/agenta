// @vitest-environment jsdom
/**
 * Remote release text renders with `httpsOnly`: every link and image that is not an absolute https
 * URL renders blocked, however the source spells it.
 */
import {createElement} from "react"

import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import ChatMarkdown from "../../src/components/ChatMarkdown"

const render = (content: string, httpsOnly = true) =>
    renderToStaticMarkup(
        createElement(ChatMarkdown, {content, baseClassName: "", httpsOnly} as never),
    )

describe("ChatMarkdown httpsOnly", () => {
    it.each([
        "[a](http://evil.example/x)",
        "[a](http\\://evil.example/x)",
        "[a](http&#58;//evil.example/x)",
        "[a][r]\n\n[r]: http\\://evil.example/x",
        "<http://evil.example/x>",
        "www.evil.example",
        "[a](mailto:x@evil.example)",
        "[a](evil.example/x)",
        "[a](//evil.example/x)",
        '<a href="http://evil.example/x">a</a>',
        "[a](JaVaScRiPt:alert(1))",
        "[a](data:text/html,x)",
    ])("blocks the link in %j", (content) => {
        const html = render(content)
        expect(html).not.toContain("<a")
        expect(html).not.toContain('href="http:')
    })

    it("blocks an image that is not https, so the browser never fetches it", () => {
        const html = render("![i](http\\://evil.example/i.png)")
        expect(html).not.toContain("<img")
        expect(html).not.toContain("<link")
        expect(html).toContain("i [blocked]")
    })

    it("blocks an image inside a blocked link", () => {
        const html = render("[![pixel](http://evil.example/p.png)](http://evil.example)")
        expect(html).not.toContain("<a")
        expect(html).not.toContain("<img")
        expect(html).not.toContain("<link")
        expect(html).toContain("pixel [blocked]")
    })

    it("keeps an https link", () => {
        expect(render("[More](https://agenta.ai/docs)")).toContain('href="https://agenta.ai/docs"')
    })

    it("leaves other surfaces as they were", () => {
        expect(render("[a](http://example.com/x)", false)).toContain('href="http://example.com/x"')
    })
})
