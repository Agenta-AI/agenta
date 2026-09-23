import {useEffect, useState} from "react"

import {RUN_CSP, SANDBOX_FLAGS} from "@agenta/entities/drive"
import {KIT_CSS, resolveKitTokens, tokensToCss} from "@agenta/entity-ui/drive/htmlApp/kit"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The kit as the assembler injects it: CSP meta, resolved tokens, the kit, then app markup, in a
// sandboxed iframe with an opaque origin. Tokens are re-resolved from the Storybook document
// whenever the theme toolbar toggles the `.dark` class, so the app follows the host theme.
const meta = {
    title: "@agenta/entity-ui/Drive/HtmlApp/Kit",
    parameters: {layout: "padded"},
} satisfies Meta

export default meta
type Story = StoryObj

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")

function useKitTokensCss(): string {
    const [css, setCss] = useState(() =>
        typeof document === "undefined"
            ? ""
            : tokensToCss(resolveKitTokens(document.documentElement)),
    )
    useEffect(() => {
        const root = document.documentElement
        const update = () => setCss(tokensToCss(resolveKitTokens(root)))
        update()
        const observer = new MutationObserver(update)
        observer.observe(root, {
            attributes: true,
            attributeFilter: ["class", "style", "data-theme"],
        })
        return () => observer.disconnect()
    }, [])
    return css
}

function AppFrame({
    markup,
    height = 360,
    width = 720,
}: {
    markup: string
    height?: number
    width?: number
}) {
    const tokensCss = useKitTokensCss()
    const srcDoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Agenta app kit sample</title><meta http-equiv="Content-Security-Policy" content="${escapeAttr(RUN_CSP)}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${tokensCss}</style><style>${KIT_CSS}</style></head><body>${markup}</body></html>`
    return (
        <iframe
            title="Agenta app kit sample"
            sandbox={SANDBOX_FLAGS}
            srcDoc={srcDoc}
            style={{
                width,
                maxWidth: "100%",
                height,
                border: "1px solid var(--ag-colorBorderSecondary)",
                borderRadius: 6,
                background: "var(--ag-colorBgContainer)",
            }}
        />
    )
}

const TYPE_AND_LAYOUT = `
<main class="ag-app">
  <header class="ag-toolbar">
    <h1>Type &amp; layout</h1>
    <span class="ag-badge">12px base</span>
  </header>
  <div class="ag-columns">
    <section class="ag-column">
      <h2>Column</h2>
      <p>Body text at 12px/1.45 on <code>--ag-bg</code>. <a href="#">A link</a> and <small>small muted text</small>.</p>
      <h3>Heading 3</h3>
      <ul class="ag-list">
        <li class="ag-card">List item one</li>
        <li class="ag-card">List item two</li>
      </ul>
    </section>
    <section class="ag-column">
      <h2>Grid <span class="ag-badge">tabular</span></h2>
      <div class="ag-grid">
        <div class="ag-card">1,024.50</div>
        <div class="ag-card">11.00</div>
        <div class="ag-card">987.25</div>
        <div class="ag-card">0.75</div>
      </div>
      <p class="ag-muted">Columns wrap to one under 480px.</p>
    </section>
  </div>
</main>`

const CONTROLS = `
<main class="ag-app">
  <header class="ag-toolbar">
    <h1>Controls</h1>
    <button class="ag-btn" type="button">Default</button>
    <button class="ag-btn ag-btn-primary" type="button">Primary</button>
  </header>
  <form class="ag-columns" onsubmit="return false">
    <div class="ag-column">
      <h2>Buttons</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="ag-btn" type="button">Button</button>
        <button class="ag-btn ag-btn-primary" type="button">Primary</button>
        <button class="ag-btn" type="button" disabled>Disabled</button>
        <button class="ag-btn ag-btn-primary" type="button" disabled>Disabled</button>
        <button class="ag-btn" type="button" autofocus>Focused</button>
      </div>
    </div>
    <div class="ag-column">
      <h2>Fields</h2>
      <label>Name <input class="ag-input" placeholder="Placeholder" aria-label="Name"></label>
      <input class="ag-input" value="Disabled" disabled aria-label="Disabled field">
      <select class="ag-select" aria-label="Priority"><option>Normal</option><option>High</option></select>
      <textarea class="ag-input" placeholder="Notes" aria-label="Notes"></textarea>
      <label><input class="ag-check" type="checkbox" checked> Checked</label>
      <label><input class="ag-check" type="checkbox"> Unchecked</label>
      <label><input class="ag-check" type="checkbox" disabled> Disabled</label>
    </div>
  </form>
</main>`

const SURFACES = `
<main class="ag-app">
  <header class="ag-toolbar"><h1>Surfaces</h1></header>
  <div class="ag-columns">
    <div class="ag-column">
      <h2>Cards &amp; badges</h2>
      <div class="ag-card">A card on <code>--ag-line</code> with the light-only shadow.</div>
      <div class="ag-card" style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="ag-badge">Default</span>
        <span class="ag-badge" data-tone="ok">Ok</span>
        <span class="ag-badge" data-tone="warn">Warn</span>
        <span class="ag-badge" data-tone="crit">Crit</span>
      </div>
    </div>
    <div class="ag-column">
      <h2>Empty</h2>
      <div class="ag-empty">Nothing here yet. Add a card to get started.</div>
    </div>
  </div>
  <div class="ag-toast" role="status">Saved data/cards.json</div>
</main>`

const STATES = `
<main class="ag-app">
  <header class="ag-toolbar"><h1>States</h1></header>
  <div class="ag-columns">
    <div class="ag-column">
      <h2>Dragging</h2>
      <div class="ag-card" draggable="true">Draggable (grab cursor)</div>
      <div class="ag-card" draggable="true" data-dragging>Being dragged</div>
    </div>
    <div class="ag-column" data-over>
      <h2>Drop target</h2>
      <div class="ag-card">Column with <code>data-over</code></div>
    </div>
    <div class="ag-column" aria-busy="true">
      <h2>Busy</h2>
      <div class="ag-card">Dimmed by <code>aria-busy</code></div>
      <button class="ag-btn" type="button">No pointer events</button>
    </div>
    <div class="ag-column">
      <h2>Hidden</h2>
      <div class="ag-card" hidden>You cannot see me</div>
      <div class="ag-card">The card above is <code>[hidden]</code></div>
    </div>
  </div>
</main>`

const BOARD = `
<main class="ag-app">
  <header class="ag-toolbar">
    <h1>Retro board</h1>
    <form id="add" style="display:flex;gap:6px">
      <input class="ag-input" id="text" placeholder="Add a card" aria-label="Card text" required>
      <select class="ag-select" id="col" aria-label="Column">
        <option value="went-well">Went well</option>
        <option value="to-improve">To improve</option>
        <option value="actions">Actions</option>
      </select>
      <button class="ag-btn ag-btn-primary" type="submit">Add</button>
    </form>
  </header>
  <div class="ag-columns">
    <section class="ag-column" data-col="went-well">
      <h2>Went well <span class="ag-badge" data-tone="ok">3</span></h2>
      <ul class="ag-list">
        <li class="ag-card" draggable="true">Shipped the drive on time</li>
        <li class="ag-card" draggable="true">Pairing on the bridge protocol</li>
        <li class="ag-card" draggable="true">Storybook caught two regressions</li>
      </ul>
    </section>
    <section class="ag-column" data-col="to-improve">
      <h2>To improve <span class="ag-badge" data-tone="warn">2</span></h2>
      <ul class="ag-list">
        <li class="ag-card" draggable="true">Too many late-night deploys</li>
        <li class="ag-card" draggable="true" data-dragging>Flaky VRT on tiny controls</li>
      </ul>
    </section>
    <section class="ag-column" data-col="actions">
      <h2>Actions <span class="ag-badge" data-tone="crit">0</span></h2>
      <ul class="ag-list"></ul>
      <div class="ag-empty">No actions yet</div>
    </section>
  </div>
  <div class="ag-toast" role="status" data-fade>Loaded 5 cards from data/cards.json</div>
</main>
<script>
  document.getElementById("add").addEventListener("submit", function (e) {
    e.preventDefault()
    var text = document.getElementById("text")
    var col = document.querySelector('[data-col="' + document.getElementById("col").value + '"]')
    var li = document.createElement("li")
    li.className = "ag-card"
    li.draggable = true
    li.textContent = text.value
    col.querySelector(".ag-list").appendChild(li)
    var empty = col.querySelector(".ag-empty")
    if (empty) empty.hidden = true
    var badge = col.querySelector(".ag-badge")
    badge.textContent = String(col.querySelectorAll(".ag-card").length)
    text.value = ""
    var toast = document.createElement("div")
    toast.className = "ag-toast"
    toast.setAttribute("role", "status")
    toast.dataset.fade = ""
    toast.textContent = "Saved data/cards.json"
    document.querySelector(".ag-toast") && document.querySelector(".ag-toast").remove()
    document.body.appendChild(toast)
  })
</script>`

/** Reset, 12px type, `.ag-app` / `.ag-toolbar` / `.ag-columns` / `.ag-list` / `.ag-grid`. */
export const TypeAndLayout: Story = {
    render: () => <AppFrame markup={TYPE_AND_LAYOUT} />,
}

/** `.ag-btn`, `.ag-btn-primary`, `.ag-input`, `.ag-select`, `.ag-check` with focus and disabled. */
export const Controls: Story = {
    render: () => <AppFrame markup={CONTROLS} />,
}

/** `.ag-card`, `.ag-badge` tones, `.ag-empty`, `.ag-toast`. */
export const Surfaces: Story = {
    render: () => <AppFrame markup={SURFACES} />,
}

/** `[data-dragging]`, `[data-over]`, `[aria-busy]`, `[hidden]`. */
export const States: Story = {
    render: () => <AppFrame markup={STATES} />,
}

/** Three columns of cards, an add form, a badge per column and a fading toast — lane D's reference. */
export const BoardSample: Story = {
    render: () => <AppFrame markup={BOARD} height={420} />,
}

/** The same board at phone width: `.ag-columns` stacks to one column. */
export const BoardNarrow: Story = {
    render: () => <AppFrame markup={BOARD} height={560} width={360} />,
}
