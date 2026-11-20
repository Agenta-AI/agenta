import { controlScale } from "../../../../web/oss/src/styles/theme/controlScale";
import { shadcnTokens } from "../../../../web/oss/src/styles/theme/shadcnTokens";
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../../../web/packages/agenta-ui/src/components/ui/{button,tabs,split-pane}.tsx",
  ],
  theme: {
    extend: {
      ...controlScale,
      colors: {
        ...shadcnTokens,
        colorBorderSecondary: "var(--ag-colorBorderSecondary)",
        colorBorder: "var(--ag-colorBorder)",
        colorTextTertiary: "var(--ag-colorTextTertiary)",
        colorPrimary: "var(--ag-colorPrimary)",
      },
    },
  },
  plugins: [],
};
