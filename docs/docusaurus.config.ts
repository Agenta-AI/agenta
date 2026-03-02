// @ts-check
import { themes as prismThemes } from "prism-react-renderer";
import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import type * as Plugin from "@docusaurus/types/src/plugin";
import type * as OpenApiPlugin from "docusaurus-plugin-openapi-docs";
import "dotenv/config";

const config: Config = {
  title: "Docs - Agenta",
  tagline: "The LLMOps platform.",
  favicon: "images/favicon.ico",
  // Public site lives on the main domain under /docs
  url: "https://agenta.ai",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/docs/",
  organizationName: "Agenta-AI",
  projectName: "agenta",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "throw",
  onBrokenAnchors: "throw",
  titleDelimiter: "-",
  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans". 
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  scripts: [
    {
      src: "https://www.googletagmanager.com/gtag/js?id=G-LTF78FZS33",
      async: true,
    },
    {
      src: "/docs/hotjar.js",
      async: true,
    },
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          path: "docs",
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/Agenta-AI/agenta/tree/main/docs",
          docItemComponent: "@theme/ApiItem",
          breadcrumbs: false,
        },
        blog: {
          routeBasePath: "/changelog",
          showReadingTime: false,
          feedOptions: {
            type: ["rss", "atom"],
          },
          blogSidebarCount: 0,
          editUrl: "https://github.com/Agenta-AI/agenta/tree/main/docs",
          onInlineTags: "ignore",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "images/social-card.png",
    docs: {
      sidebar: {
        hideable: false,
        autoCollapseCategories: false,
      },
    },
    navbar: {
      logo: {
        alt: "agenta-ai",
        src: "images/Agenta-logo-full-light.png",
        srcDark: "images/Agenta-logo-full-dark-accent.png",
      },
      hideOnScroll: false,
      items: [
        {
          type: "doc",
          sidebarId: "docsSidebar",
          docId: "getting-started/introduction",
          position: "left",
          label: "Docs",
          customProps: {
            icon: {
              name: "fileText",
            },
          },
        },
        {
          type: "docSidebar",
          sidebarId: "guidesSidebar",
          position: "left",
          label: "Tutorials",
          customProps: {
            icon: {
              name: "bookOpen",
            },
          },
        },
        {
          type: "docSidebar",
          sidebarId: "refrenceSidebar",
          position: "left",
          label: "Reference",
          customProps: {
            icon: {
              name: "code",
            },
          },
        },
        {
          type: "docSidebar",
          sidebarId: "integrationsSidebar",
          position: "left",
          label: "Integrations",
          customProps: {
            icon: {
              name: "puzzle",
            },
          },
        },
        {
          to: "/roadmap",
          position: "left",
          label: "Roadmap",
          customProps: {
            icon: {
              name: "route",
            },
          },
        },
        {
          to: "/changelog/main",
          position: "left",
          label: "Changelog",
          customProps: {
            icon: {
              name: "clock",
            },
          },
        },
        {
          type: "docSidebar",
          sidebarId: "selfHostSidebar",
          position: "left",
          label: "Self-host",
          customProps: {
            icon: {
              name: "server",
            },
          },
        },
        {
          type: "docSidebar",
          sidebarId: "administrationSidebar",
          position: "left",
          label: "Enterprise",
          customProps: {
            icon: {
              name: "shield",
            },
          },
        },

        // {
        //   to: "https://github.com/orgs/Agenta-AI/projects/13/views/1",
        //   position: "left",
        //   label: "Roadmap",
        // },
        // nav social links
        {
          type: "search",
          position: "right",
        },
        {
          href: "https://cal.com/mahmoud-mabrouk-ogzgey/demo",
          position: "right",
          html: "<button class='nav_secondary_button'>Book A Demo</button>",
        },
        {
          href: "https://cloud.agenta.ai/",
          position: "right",
          html: "<button class='nav_primary_button'>Start for Free</button>",
        },
        {
          href: "https://github.com/Agenta-AI/agenta",
          position: "right",
          html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512" class="theme-icon nav_github_icons"><path d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3 .3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5 .3-6.2 2.3zm44.2-1.7c-2.9 .7-4.9 2.6-4.6 4.9 .3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3 .7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3 .3 2.9 2.3 3.9 1.6 1 3.6 .7 4.3-.7 .7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3 .7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3 .7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z" fill="currentColor" /></svg>',
        },
        {
          href: "https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw",
          html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" class="theme-icon nav_slack_icons"><path d="M94.1 315.1c0 25.9-21.2 47.1-47.1 47.1S0 341 0 315.1c0-25.9 21.2-47.1 47.1-47.1h47.1v47.1zm23.7 0c0-25.9 21.2-47.1 47.1-47.1s47.1 21.2 47.1 47.1v117.8c0 25.9-21.2 47.1-47.1 47.1s-47.1-21.2-47.1-47.1V315.1zm47.1-189c-25.9 0-47.1-21.2-47.1-47.1S139 32 164.9 32s47.1 21.2 47.1 47.1v47.1H164.9zm0 23.7c25.9 0 47.1 21.2 47.1 47.1s-21.2 47.1-47.1 47.1H47.1C21.2 244 0 222.8 0 196.9s21.2-47.1 47.1-47.1H164.9zm189 47.1c0-25.9 21.2-47.1 47.1-47.1 25.9 0 47.1 21.2 47.1 47.1s-21.2 47.1-47.1 47.1h-47.1V196.9zm-23.7 0c0 25.9-21.2 47.1-47.1 47.1-25.9 0-47.1-21.2-47.1-47.1V79.1c0-25.9 21.2-47.1 47.1-47.1 25.9 0 47.1 21.2 47.1 47.1V196.9zM283.1 385.9c25.9 0 47.1 21.2 47.1 47.1 0 25.9-21.2 47.1-47.1 47.1-25.9 0-47.1-21.2-47.1-47.1v-47.1h47.1zm0-23.7c-25.9 0-47.1-21.2-47.1-47.1 0-25.9 21.2-47.1 47.1-47.1h117.8c25.9 0 47.1 21.2 47.1 47.1 0 25.9-21.2 47.1-47.1 47.1H283.1z" fill="currentColor" /></svg>',
          position: "right",
        },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.vsDark,

      prism: {

        additionalLanguages: ["ruby", "csharp", "php", "java", "powershell", "json", "bash"],

        magicComments: [
          // Remember to extend the default highlight class name as well!
          {
            className: "theme-code-block-highlighted-line",
            line: "highlight-next-line",
            block: { start: "highlight-start", end: "highlight-end" },
          },
          {
            className: "code-block-error-line",
            line: "highlight-error",
          },
        ],
      },
      languageTabs: [
        {
          highlight: "python",
          language: "python",
          logoClass: "python",
        },
        {
          highlight: "bash",
          language: "curl",
          logoClass: "bash",
        },
        {
          highlight: "csharp",
          language: "csharp",
          logoClass: "csharp",
        },
        {
          highlight: "go",
          language: "go",
          logoClass: "go",
        },
        {
          highlight: "javascript",
          language: "nodejs",
          logoClass: "nodejs",
        },
        {
          highlight: "ruby",
          language: "ruby",
          logoClass: "ruby",
        },
        {
          highlight: "php",
          language: "php",
          logoClass: "php",
        },
        {
          highlight: "java",
          language: "java",
          logoClass: "java",
          variant: "unirest",
        },
        {
          highlight: "powershell",
          language: "powershell",
          logoClass: "powershell",
        },
      ],
    } satisfies Preset.ThemeConfig,
    algolia: {
      askAi: 'I14hRlCxbWzW',
      appId: "0HZ4ONM2EC",
      apiKey: "18ab633e81d706cbda7c78d25d0fe763",
      indexName: "agenta",
    },
    // For image zoom plugin
    zoom: {
      config: {
        margin: 50,
      },
    },
  },
  plugins: [
    async function myPlugin(context, options) {
      return {
        name: "docusaurus-tailwindcss",
        configurePostCss(postcssOptions) {
          // Appends TailwindCSS
          postcssOptions.plugins.push(require("tailwindcss"));
          return postcssOptions;
        },
      };
    },
    [
      "docusaurus-plugin-openapi-docs",
      {
        id: "openapi",
        docsPluginId: "classic",
        config: {
          agenta: {
            specPath: "docs/reference/openapi.json",
            outputDir: "docs/reference/api",
            downloadUrl:
              "https://raw.githubusercontent.com/Agenta-AI/agenta/refs/heads/main/docs/docs/reference/openapi.json",
            sidebarOptions: {
              groupPathsBy: "tag",
              categoryLinkSource: "tag",
            },
          } satisfies OpenApiPlugin.Options,
        } satisfies Plugin.PluginOptions,
      },
    ],
    [
      "posthog-docusaurus",
      {
        apiKey: process.env.POSTHOG_API_KEY || "dummy",  // Posthog is only available on the prod website
        appUrl: "https://agenta.ai/docs",
        enableInDevelopment: false, // optional
        api_host: "https://alef.agenta.ai",
        ui_host: "https://us.posthog.com",
      },
    ],
    [
      "@docusaurus/plugin-client-redirects",
      {
        redirects: [
          {
            from: "/prompt-management/creating-a-custom-template",
            to: "/custom-workflows/quick-start",
          },
          {
            from: "/self-host/deploy_remotely/host-remotely",
            to: "/self-host/guides/deploy-remotely",
          },
          {
            from: "/self-host/deploy_remotely/host-on-kubernetes",
            to: "/self-host/guides/deploy-to-kubernetes",
          },
          {
            from: "/self-host/migration/applying-schema-migration",
            to: "/self-host/upgrading",
          },
          {
            from: "/reference/sdk/quick_start",
            to: "/reference/sdk/configuration-management",
          },
          {
            from: "/prompt-management/overview",
            to: "/prompt-engineering/concepts",
          },
          {
            from: "/prompt-management/quick-start",
            to: "/prompt-engineering/quick-start",
          },
          {
            from: "/prompt-management/prompt-management-sdk",
            to: "/prompt-engineering/managing-prompts-programatically/create-and-commit",
          },
          {
            from: "/prompt-management/adding-custom-providers",
            to: "/prompt-engineering/playground/custom-providers",
          },
          {
            from: "/prompt-management/using-the-playground",
            to: "/prompt-engineering/playground/using-playground",
          },
          {
            from: "/prompt-management/integration/how-to-integrate-with-agenta",
            to: "/prompt-engineering/integrating-prompts/integrating-with-agenta",
          },
          {
            from: "/prompt-management/integration/fetch-prompts",
            to: "/prompt-engineering/integrating-prompts/fetch-prompt-programatically",
          },
          {
            from: "/prompt-management/integration/proxy-calls",
            to: "/prompt-engineering/integrating-prompts/proxy-calls",
          },
          {
            from: "/self-host/host-locally",
            to: "/self-host/quick-start",
          },
          {
            from: "/self-host/host-remotely",
            to: "/self-host/guides/deploy-remotely",
          },
          {
            from: "/self-host/host-on-kubernetes",
            to: "/self-host/guides/deploy-to-kubernetes",
          },
          {
            from: "/self-host/applying-schema-migration",
            to: "/self-host/upgrading",
          },
          // FAQ restructure redirects
          {
            from: "/misc/faq",
            to: "/faq",
          },
          // Prompt Engineering restructure redirects
          {
            from: "/prompt-engineering/overview",
            to: "/prompt-engineering/concepts",
          },
          {
            from: "/prompt-engineering/prompt-management/how-to-integrate-with-agenta",
            to: "/prompt-engineering/integrating-prompts/integrating-with-agenta",
          },
          {
            from: "/prompt-engineering/prompt-management/prompt-management-sdk",
            to: "/prompt-engineering/managing-prompts-programatically/create-and-commit",
          },
          {
            from: "/prompt-engineering/prompt-management/proxy-calls",
            to: "/prompt-engineering/integrating-prompts/proxy-calls",
          },
          {
            from: "/prompt-engineering/playground/using-the-playground",
            to: "/prompt-engineering/playground/using-playground",
          },
          {
            from: "/prompt-engineering/playground/adding-custom-providers",
            to: "/prompt-engineering/playground/custom-providers",
          },
          // Evaluation restructure redirects
          {
            from: "/evaluation/create-test-sets",
            to: "/evaluation/managing-test-sets/upload-csv",
          },
          {
            from: "/evaluation/no-code-evaluation",
            to: "/evaluation/evaluation-from-ui/running-evaluations",
          },
          {
            from: "/evaluation/sdk-evaluation",
            to: "/evaluation/concepts",
          },
          {
            from: "/evaluation/configure-evaluators",
            to: "/evaluation/configure-evaluators/overview",
          },
          {
            from: "/evaluation/human_evaluation",
            to: "/evaluation/human-evaluation/quick-start",
          },
          {
            from: "/evaluation/annotate-api",
            to: "/observability/trace-with-python-sdk/annotate-traces",
          },
          {
            from: "/evaluation/evaluators/classification-entiry-extraction",
            to: "/evaluation/configure-evaluators/classification-entity-extraction",
          },
          {
            from: "/evaluation/evaluators/pattern-matching",
            to: "/evaluation/configure-evaluators/regex-evaluator",
          },
          {
            from: "/evaluation/configure-evaluators/pattern-matching",
            to: "/evaluation/configure-evaluators/regex-evaluator",
          },
          {
            from: "/evaluation/evaluators/semantic-similarity",
            to: "/evaluation/configure-evaluators/semantic-similarity",
          },
          {
            from: "/evaluation/evaluators/llm-as-a-judge",
            to: "/evaluation/configure-evaluators/llm-as-a-judge",
          },
          {
            from: "/evaluation/evaluators/rag-evaluators",
            to: "/evaluation/configure-evaluators/rag-evaluators",
          },
          {
            from: "/evaluation/evaluators/custom-evaluator",
            to: "/evaluation/configure-evaluators/custom-evaluator",
          },
          {
            from: "/evaluation/evaluators/webhook-evaluator",
            to: "/evaluation/configure-evaluators/webhook-evaluator",
          },
          {
            from: "/evaluation/quick-start-ui",
            to: "/evaluation/evaluation-from-ui/quick-start",
          },
          {
            from: "/evaluation/quick-start-sdk",
            to: "/evaluation/concepts",
          },
          {
            from: "/evaluation/overview",
            to: "/evaluation/concepts",
          },
          // Observability restructure redirects
          {
            from: "/observability/observability-sdk",
            to: "/observability/trace-with-python-sdk/setup-tracing",
          },
          {
            from: "/observability/opentelemetry",
            to: "/observability/trace-with-opentelemetry/distributed-tracing",
          },
          {
            from: "/observability/otel-semconv",
            to: "/observability/trace-with-opentelemetry/semantic-conventions",
          },
          {
            from: "/observability/overview",
            to: "/observability/concepts",
          },
          {
            from: "/observability/quickstart",
            to: "/observability/quickstart-python",
          },
          {
            from: "/observability/trace-with-opentelemetry/setup-tracing",
            to: "/observability/trace-with-opentelemetry/getting-started",
          },
          {
            from: "/observability/using-the-ui/filtering-traces",
            to: "/observability/concepts",
          },
          {
            from: "/observability/concepts/semantic-conventions",
            to: "/observability/trace-with-opentelemetry/semantic-conventions",
          },
          {
            from: "/reference/api",
            to: "/reference/api/category",
          },
          // Observability integrations -> new Integrations section
          {
            from: "/observability/integrations/openai",
            to: "/integrations/llm-providers/openai/observability",
          },
          {
            from: "/observability/integrations/langchain",
            to: "/integrations/frameworks/langchain/observability",
          },
          {
            from: "/observability/integrations/instructor",
            to: "/integrations/libraries/instructor/observability",
          },
          {
            from: "/observability/integrations/litellm",
            to: "/integrations/llm-providers/litellm/observability",
          },
          {
            from: "/observability/integrations/llamaindex",
            to: "/integrations/frameworks/llamaindex/observability",
          },
          {
            from: "/observability/integrations/langgraph",
            to: "/integrations/frameworks/langgraph/observability",
          },
          {
            from: "/observability/integrations/openai-agents",
            to: "/integrations/frameworks/openai-agents/observability",
          },
          {
            from: "/observability/integrations/pydanticai",
            to: "/integrations/frameworks/pydanticai/observability",
          },
          {
            from: "/observability/integrations/dspy",
            to: "/integrations/frameworks/dspy/observability",
          },
          {
            from: "/observability/integrations/agno",
            to: "/integrations/frameworks/agno/observability",
          },
          {
            from: "/observability/integrations/google-adk",
            to: "/integrations/frameworks/google-adk/observability",
          }
        ],
        createRedirects(existingPath) {
          if (existingPath.includes('/reference/sdk/core_functions')) {
            return [
              existingPath.replace('reference/sdk/core_functions', 'reference/sdk/deprecated-v2/core_functions'),
            ];
          }
          return undefined;
        },

      },
    ],

    [
      "@docusaurus/plugin-ideal-image",
      {
        quality: 85,
        max: 1600, // max resized image's size.
        min: 600, // min resized image's size. if original is lower, use that size.
        steps: 3, // the max number of images generated between min and max (inclusive)
        disableInDev: false,
      },
    ],

    "docusaurus-plugin-image-zoom",
  ],

  themes: ["docusaurus-theme-openapi-docs"],
};

export default async function createConfig() {
  return config;
}
