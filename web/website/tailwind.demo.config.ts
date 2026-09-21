import { createConfig } from "../oss/tailwind.config";

const config = createConfig([
  "../packages/agenta-ui/src/components/presentational/section/ConfigAccordionSection.tsx",
  "../packages/agenta-ui/src/components/presentational/section/ConfigRowTrailing.tsx",
  "../packages/agenta-ui/src/components/HeightCollapse.tsx",
]);
config.important = ".ag-demo-config";
config.corePlugins = { ...config.corePlugins, preflight: false };
export default config;
