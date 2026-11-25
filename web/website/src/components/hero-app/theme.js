import mobileTheme from "../../../../mobile/src/styles/theme.generated.css?raw";

// The /m tokens (light and dark), scoped to the mockup root so the marketing chrome keeps its own.
export const heroAppTheme = mobileTheme
  .replace(/:root/g, ".hx.ag-app-frame")
  .replace(/\.dark\b/g, '[data-theme="dark"] .hx.ag-app-frame');
