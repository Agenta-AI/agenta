import appTheme from "../../../../packages/agenta-ui/src/styles/theme-variables.css?raw";
import mobileTheme from "../../../../mobile/src/styles/theme.generated.css?raw";

// Scope canonical product tokens so marketing chrome keeps its own theme.
export const demoTheme = (appTheme + mobileTheme)
  .replace(/:root/g, ".ag-app-frame")
  .replace(/\.dark/g, '[data-theme="dark"] .ag-app-frame');
