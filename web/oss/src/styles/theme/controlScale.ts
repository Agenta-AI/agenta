/**
 * Control geometry scale — the ONE definition of control dimensions.
 *
 * Shared because two toolchains consume it: web/oss (Tailwind v3, JS config) spreads it into
 * `theme.extend`, and web/mobile (Tailwind v4, CSS-first) emits it as `@theme` custom
 * properties. Keeping it in the v3 config forced mobile to copy the pixel values by hand,
 * which drifts silently — a shared component would then render at different sizes per app.
 */
// ── Control scale ────────────────────────────────────────────────
// Geometry + typography for the shadcn control primitives (Button/Input/Badge).
// The single place to retune control sizing: components reference these names and never
// raw pixels. Namespaced (`control-*`, `btn-*`, `input-*`) and purely ADDITIVE, exactly
// like the `tremor-*` scale below, so no existing `h-*`/`rounded-*`/`text-*` changes.
//
// Values are theme-invariant (they don't flip light/dark), which is why they live here
// rather than in palette.ts. They currently encode antd's measured geometry so the
// migration is visually neutral — retune HERE once antd is gone, not in the components.
//
// v4 note: this whole object becomes a `@theme` block; the class names do not change.
export const controlScale = {
    height: {
        "control-sm": "24px",
        control: "28px",
        "control-lg": "34px",
        // antd Switch track (default/small) + handle. Own dims — not the control heights.
        switch: "22px",
        "switch-sm": "16px",
        "switch-thumb": "18px",
        "switch-thumb-sm": "12px",
        // antd Checkbox/Radio box (16px) + Radio inner dot (8px) + Checkbox indeterminate dash (7px).
        "control-check": "16px",
        "control-dot": "8px",
        "control-check-dash": "7px",
    },
    width: {
        "control-sm": "24px",
        control: "28px",
        "control-lg": "34px",
        // antd Switch min track width (default/small) + handle.
        switch: "44px",
        "switch-sm": "28px",
        "switch-thumb": "18px",
        "switch-thumb-sm": "12px",
        // antd Checkbox/Radio box (16px) + Radio inner dot (8px) + Checkbox indeterminate dash (7px).
        "control-check": "16px",
        "control-dot": "8px",
        "control-check-dash": "7px",
    },
    borderRadius: {
        "control-sm": "6px",
        control: "8px",
        "control-lg": "10px",
        // antd shape="circle". 50%, not 9999px — they render identically on a square but
        // the parity gate compares computed values.
        "control-round": "50%",
    },
    spacing: {
        // Horizontal padding differs between buttons and inputs at md/lg, so they are
        // separate families rather than one fudged scale.
        "btn-sm": "7px",
        btn: "15px",
        "btn-lg": "15px",
        "input-sm": "7px",
        input: "11px",
        "input-lg": "11px",
        // Vertical padding for inputs: heights are padding + line-height derived (antd's
        // model), not fixed. `ghost` adds 1px to compensate for its missing border.
        "input-y-sm": "0px",
        "input-y": "4px",
        "input-y-lg": "7px",
        "input-y-ghost-sm": "1px",
        "input-y-ghost": "5px",
        "input-y-ghost-lg": "8px",
    },
    // Type ramps. Buttons and fields differ at `sm` (12px vs 10px), so they are separate
    // ramps rather than one averaged scale. Names avoid every colour-token name, because
    // `text-*` is shared between font-size and text-colour utilities.
    // Exact ratios, not rounded decimals: 1.8667 computes to 22.4004px where antd renders
    // 22.4 and the parity gate flags the difference.
    fontSize: {
        "btn-sm": ["12px", {lineHeight: "normal"}] as [string, {lineHeight: string}],
        "btn-md": ["12px", {lineHeight: "normal"}] as [string, {lineHeight: string}],
        "btn-lg": ["14px", {lineHeight: "normal"}] as [string, {lineHeight: string}],
        "field-sm": ["10px", {lineHeight: "1.6666666666666667"}] as [string, {lineHeight: string}],
        "field-md": ["12px", {lineHeight: "1.6666666666666667"}] as [string, {lineHeight: string}],
        "field-lg": ["14px", {lineHeight: "1.5714285714285714"}] as [string, {lineHeight: string}],
        "badge-md": ["12px", {lineHeight: "1.8666666666666667"}] as [string, {lineHeight: string}],
    },
}
