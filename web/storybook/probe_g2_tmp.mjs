import {chromium} from "playwright"
const b = await chromium.launch()
const p = await b.newPage()
await p.goto(
    "http://localhost:6006/iframe.html?id=agenta-entity-ui-drillin-leafcontrols--antd-vs-agenta&globals=theme:light&viewMode=story",
    {waitUntil: "commit", timeout: 300000},
)
await p.waitForSelector(".grid", {timeout: 180000})
await p.waitForTimeout(3000)
const out = await p.evaluate(() => {
    const rows = [...document.querySelectorAll(".grid")]
    const find = (l) => rows.find((r) => r.children[0]?.textContent?.trim() === l)
    const info = (el) => {
        if (!el) return null
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return {
            txt: (el.textContent || "").trim().slice(0, 24),
            fs: cs.fontSize,
            lh: cs.lineHeight,
            ff: cs.fontFamily.split(",")[0],
            color: cs.color,
            bg: cs.backgroundColor,
            bc: cs.borderColor,
            h: +r.height.toFixed(2),
            w: +r.width.toFixed(2),
            x: +r.x.toFixed(2),
            y: +r.y.toFixed(2),
            pad: cs.padding,
            bw: cs.borderWidth,
        }
    }
    const byText = (cell, sel, t) =>
        [...cell.querySelectorAll(sel)].find((e) => (e.textContent || "").trim().startsWith(t))
    const res = {}
    const r1 = find("auto-approve · empty")
    res.emptyAntd = info(byText(r1.children[1], "span", "Nothing auto"))
    res.emptyAgenta = info(byText(r1.children[2], "span", "Nothing auto"))
    const r2 = find("auto-approve · filled")
    res.tagAntd = info(byText(r2.children[1], ".ant-tag", "bash"))
    res.tagAgenta = info(byText(r2.children[2], "span", "bash"))
    const r3 = find("fields tags editor · filled")
    res.aggAntd = info(byText(r3.children[1], ".ant-tag", "aggregate_score"))
    res.aggAgenta = info(byText(r3.children[2], "span", "aggregate_score"))
    res.chipAntd = info(byText(r3.children[1], ".ant-tag", "user.name"))
    res.chipAgenta = info(byText(r3.children[2], "span", "user.name"))
    res.helpAntd = info(byText(r3.children[1], "span", "Each field creates"))
    res.helpAgenta = info(byText(r3.children[2], "span", "Each field creates"))
    res.qAntd = info(byText(r3.children[1], "span.text-\\[11px\\]", "?"))
    res.qAgenta = info(byText(r3.children[2], "span.text-\\[11px\\]", "?"))
    res.inAntd = info(r3.children[1].querySelector(".ant-input-affix-wrapper input"))
    res.inAgenta = info(r3.children[2].querySelector("[data-slot=input-affix] input"))
    return res
})
console.log(JSON.stringify(out, null, 1))
await b.close()
