// ICON-01: every Phosphor icon draws at this weight. The app sets it once through `IconContext`
// (web/mobile/src/pages/_app.tsx); a call site passes `weight` only for `fill` as a state. Bold, not
// regular: at the 12 to 16px icon sizes a regular stroke is 1px or less and reads faint.
// A separate module so the app shell imports one string, not the whole theme config.
export const iconWeight = "bold" as const
