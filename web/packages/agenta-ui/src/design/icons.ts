// ICON-01: every Phosphor icon draws at this weight. The app sets it once through `IconContext`
// (web/mobile/src/pages/_app.tsx); a call site passes `weight` only for `fill` as a state. Bold, not
// regular: at the 12 to 16px icon sizes a regular stroke is 1px or less and reads faint.
// A separate module so the app shell imports one string, not the whole theme config.
export const iconWeight = "regular" as const

// Phosphor ships fixed weights only (regular draws a 16-unit line, bold a 24-unit line, in a
// 256-unit box). The app draws regular icons and adds this outline in the icon's own color, so the
// line is 16 + 1.6 = 17.6 units: 27% lighter than bold. The CSS rule in web/mobile globals.css
// keys on `iconStrokeAttr`.
export const iconStrokeAttr = "data-icon-stroke" as const
export const iconStrokeWidth = 1.6
