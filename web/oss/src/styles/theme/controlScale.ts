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
// Values are theme-invariant, which is why they live here rather than in palette.ts. They
// encode shadcn's control geometry (the antd theme dump matches); retune HERE, not in components.
//
// v4 note: this whole object becomes a `@theme` block; the class names do not change.
export const controlScale = {
    height: {
        // shadcn control boxes (h-6/7/8/9) — Button, Input, Select, Segmented share them.
        "control-xs": "24px",
        "control-sm": "28px",
        control: "32px",
        "control-lg": "36px",
        // antd Avatar boxes; pinned so avatars don't grow with the control scale.
        "avatar-sm": "24px",
        avatar: "28px",
        "avatar-lg": "34px",
        // In-button glyph sizes (size-3 / 3.5 / 4).
        "btn-icon-xs": "12px",
        "btn-icon-sm": "14px",
        "btn-icon": "16px",
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
        "control-xs": "24px",
        "control-sm": "28px",
        control: "32px",
        "control-lg": "36px",
        "avatar-sm": "24px",
        avatar: "28px",
        "avatar-lg": "34px",
        "btn-icon-xs": "12px",
        "btn-icon-sm": "14px",
        "btn-icon": "16px",
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
    // shadcn radii at --radius 0.625rem: xs/sm 8px, the rest 10px.
    borderRadius: {
        "control-xs": "8px",
        "control-sm": "8px",
        control: "10px",
        "control-lg": "10px",
        // antd shape="circle". 50%, not 9999px — they render identically on a square but
        // the parity gate compares computed values.
        "control-round": "50%",
    },
    spacing: {
        // Horizontal padding differs between buttons and inputs at md/lg, so they are
        // separate families rather than one fudged scale.
        // Button padding (px-2 / 2.5); `btn-icon-pad*` trims the icon side (pl-1.5 / 2).
        "btn-xs": "8px",
        "btn-sm": "10px",
        btn: "10px",
        "btn-lg": "10px",
        "btn-icon-pad-sm": "6px",
        "btn-icon-pad": "8px",
        // Glyph↔label gap (gap-1 / 1.5).
        "btn-gap-sm": "4px",
        "btn-gap": "6px",
        "input-sm": "8px",
        input: "10px",
        "input-lg": "10px",
        // Input heights are padding + line-height: 3/5/5 + 20/20/24 + 2 = 28/32/36; `ghost` adds 1px for its missing border.
        "input-y-sm": "3px",
        "input-y": "5px",
        "input-y-lg": "5px",
        "input-y-ghost-sm": "4px",
        "input-y-ghost": "6px",
        "input-y-ghost-lg": "6px",
    },
    // Type ramps. Buttons and fields differ at `sm` (14px vs 12px), so they are separate
    // ramps rather than one averaged scale. Names avoid every colour-token name, because
    // `text-*` is shared between font-size and text-colour utilities.
    // Exact ratios, not rounded decimals: 1.8667 computes to 22.4004px where antd renders
    // 22.4 and the parity gate flags the difference.
    fontSize: {
        // Button text ramp, with `sm` on the app's text-xs step (13/18) instead of shadcn's 0.8rem.
        "btn-xs": ["12px", {lineHeight: "16px"}] as [string, {lineHeight: string}],
        "btn-sm": ["13px", {lineHeight: "18px"}] as [string, {lineHeight: string}],
        "btn-md": ["14px", {lineHeight: "20px"}] as [string, {lineHeight: string}],
        "btn-lg": ["14px", {lineHeight: "20px"}] as [string, {lineHeight: string}],
        "field-sm": ["12px", {lineHeight: "1.6666666666666667"}] as [string, {lineHeight: string}],
        "field-md": ["14px", {lineHeight: "1.4285714285714286"}] as [string, {lineHeight: string}],
        "field-lg": ["16px", {lineHeight: "1.5"}] as [string, {lineHeight: string}],
        "badge-md": ["12px", {lineHeight: "1.8666666666666667"}] as [string, {lineHeight: string}],
    },
}
