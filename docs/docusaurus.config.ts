// @ts-check
import { themes as prismThemes } from "prism-react-renderer";
import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import type * as Plugin from "@docusaurus/types/src/plugin";
import type * as OpenApiPlugin from "docusaurus-plugin-openapi-docs";
import "dotenv/config";

const config: Config = {
  title: "Docs - Agenta",
  tagline: "The open-source workspace for your agents.",
  favicon: "images/favicon.ico",
  // Public site lives on the main domain under /docs
  url: "https://agenta.ai",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/docs/",
  organizationName: "Agenta-AI",
  projectName: "agenta",
  // Preview deploys go to a public *.workers.dev URL. DOCS_NOINDEX=true (set by
  // .github/workflows/18-docs-preview.yml) keeps them out of search indexes so
  // they never rank as duplicates of the real docs. Production leaves it unset.
  noIndex: process.env.DOCS_NOINDEX === "true",
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

  // Rendered by src/theme/Footer; the footer config schema has no slot for them.
  customFields: {
    footerSocials: [
      { label: "X", href: "https://x.com/agenta_ai", icon: "x" },
      { label: "LinkedIn", href: "https://www.linkedin.com/company/agenta-ai", icon: "linkedin" },
      { label: "GitHub", href: "https://github.com/Agenta-AI/agenta", icon: "github" },
      {
        label: "Slack community",
        href: "https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw",
        icon: "slack",
      },
    ],
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
          // No editUrl: the page footer's "Edit this page" link is not shown.
          docItemComponent: "@theme/ApiItem",
          breadcrumbs: false,
          // The current docs (the agent product) are the default and keep the
          // existing URLs. Version 1.0 is the frozen documentation of the
          // previous product, served under /1.0/.
          lastVersion: "current",
          versions: {
            current: {
              label: "v2.0",
              path: "",
            },
            "1.0": {
              label: "v1.0",
              path: "1.0",
              banner: "unmaintained",
            },
          },
        },
        blog: {
          routeBasePath: "/changelog",
          blogTitle: "Changelog",
          blogDescription: "New features, improvements, and fixes in Agenta.",
          postsPerPage: 10,
          // Keep internal assets (social copy, etc.) out of the published blog.
          // The first four globs restate the Docusaurus defaults.
          exclude: [
            "**/_*.{js,jsx,ts,tsx,md,mdx}",
            "**/_*/**",
            "**/*.test.{js,jsx,ts,tsx}",
            "**/__tests__/**",
            "announcement-assets/**",
          ],
          showReadingTime: false,
          feedOptions: {
            type: ["rss", "atom"],
          },
          // The sidebar lists the latest releases under the section rail.
          blogSidebarCount: 20,
          blogSidebarTitle: "Releases",
          onInlineTags: "ignore",
          // Short entries are shown in full on the list page; only long
          // entries carry a {/* truncate */} marker.
          onUntruncatedBlogPosts: "ignore",
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
    blog: {
      // A flat list of releases, not one heading per year.
      sidebar: { groupByYear: false },
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
          type: "docsVersionDropdown",
          position: "right",
          dropdownItemsAfter: [],
          dropdownActiveClassDisabled: true,
        },
        {
          type: "doc",
          docId: "getting-started/introduction",
          position: "left",
          label: "Docs",
          customProps: {
            icon: {
              name: "fileText",
            },
          },
        },
        // Hidden during the agent-focused docs rework. The tutorials pages and
        // their sidebar still exist and stay reachable by direct URL.
        // {
        //   type: "docSidebar",
        //   sidebarId: "guidesSidebar",
        //   position: "left",
        //   label: "Tutorials",
        //   customProps: {
        //     icon: {
        //       name: "bookOpen",
        //     },
        //   },
        // },
        {
          // Plain link: the REST reference is not versioned, it only exists in
          // the current version.
          to: "/reference/api-guide/overview",
          activeBasePath: "/reference",
          position: "left",
          label: "Reference",
          customProps: {
            icon: {
              name: "code",
            },
          },
        },
        // Hidden during the agent-focused docs rework. The integrations pages and
        // their sidebar still exist and stay reachable by direct URL.
        // {
        //   type: "docSidebar",
        //   sidebarId: "integrationsSidebar",
        //   position: "left",
        //   label: "Integrations",
        //   customProps: {
        //     icon: {
        //       name: "puzzle",
        //     },
        //   },
        // },
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
          to: "/changelog",
          position: "left",
          label: "Changelog",
          customProps: {
            icon: {
              name: "clock",
            },
          },
        },
        {
          // Plain link: self-hosting is not versioned.
          to: "/self-host/overview",
          activeBasePath: "/self-host",
          position: "left",
          label: "Self-host",
          customProps: {
            icon: {
              name: "server",
            },
          },
        },
        {
          // Plain link: the enterprise pages are not versioned.
          to: "/administration/security/overview",
          activeBasePath: "/administration",
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
          html: "<button class='nav_secondary_button'>Book a demo</button>",
        },
        {
          href: "https://cloud.agenta.ai/",
          position: "right",
          html: "<button class='nav_primary_button'>Get started</button>",
        },
      ],
    },
    footer: {
      logo: {
        alt: "Agenta",
        src: "images/Agenta-logo-full-light.png",
        srcDark: "images/Agenta-logo-full-dark-accent.png",
        href: "https://agenta.ai",
      },
      links: [
        {
          title: "Product",
          items: [
            { label: "Docs", to: "/" },
            { label: "Reference", to: "/reference/api-guide/overview" },
            { label: "Roadmap", to: "/roadmap" },
            { label: "Changelog", to: "/changelog" },
          ],
        },
        {
          title: "Deploy",
          items: [
            { label: "Agenta Cloud", href: "https://cloud.agenta.ai/" },
            { label: "Self-host", to: "/self-host/overview" },
            { label: "Enterprise", to: "/administration/security/overview" },
            { label: "Pricing", href: "https://agenta.ai/pricing" },
          ],
        },
        {
          title: "Company",
          items: [
            { label: "Website", href: "https://agenta.ai" },
            { label: "Blog", href: "https://agenta.ai/blog" },
            { label: "Book a demo", href: "https://cal.com/mahmoud-mabrouk-ogzgey/demo" },
            { label: "Contact", href: "https://agenta.ai/contact" },
          ],
        },
        {
          title: "Legal",
          items: [
            { label: "Privacy policy", to: "/administration/security/privacy-policy" },
            { label: "Terms of service", to: "/administration/security/terms-of-service" },
            { label: "DPA", to: "/administration/security/dpa" },
            { label: "Imprint", href: "https://agenta.ai/imprint" },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Agenta`,
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
            from: "/changelog/main",
            to: "/changelog",
          },
          {
            from: "/prompt-management/creating-a-custom-template",
            to: "/1.0/custom-workflows/quick-start",
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
            from: "/self-host/guides/deploy-the-agent-runner",
            to: "/self-host/agent-execution/how-agents-run",
          },
          {
            from: "/self-host/guides/custom-agent-runner-images",
            to: "/self-host/agent-execution/customize-the-agent-runtime",
          },
          {
            from: "/self-host/guides/agent-daytona-sandboxes",
            to: "/self-host/agent-execution/daytona",
          },
          {
            from: "/self-host/agent-execution/runner-configuration",
            to: "/self-host/configuration",
          },
          {
            from: "/reference/sdk/quick_start",
            to: "/1.0/reference/sdk/configuration-management",
          },
          {
            from: "/prompt-management/overview",
            to: "/1.0/prompt-engineering/concepts",
          },
          {
            from: "/prompt-management/quick-start",
            to: "/1.0/prompt-engineering/quick-start",
          },
          {
            from: "/prompt-management/prompt-management-sdk",
            to: "/1.0/prompt-engineering/managing-prompts-programatically/create-and-commit",
          },
          {
            from: "/prompt-management/adding-custom-providers",
            to: "/1.0/prompt-engineering/playground/custom-providers",
          },
          {
            from: "/prompt-management/using-the-playground",
            to: "/1.0/prompt-engineering/playground/using-playground",
          },
          {
            from: "/prompt-management/integration/how-to-integrate-with-agenta",
            to: "/1.0/prompt-engineering/integrating-prompts/integrating-with-agenta",
          },
          {
            from: "/prompt-management/integration/fetch-prompts",
            to: "/1.0/prompt-engineering/integrating-prompts/fetch-prompt-programatically",
          },
          {
            from: "/prompt-management/integration/proxy-calls",
            to: "/1.0/prompt-engineering/integrating-prompts/proxy-calls",
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
          // Contributing restructure redirects (old misc paths -> new top-level paths)
          {
            from: "/misc/contributing/getting-started",
            to: "/contributing/overview",
          },
          {
            from: "/misc/contributing/overview",
            to: "/contributing/overview",
          },
          {
            from: "/misc/contributing/first-pr",
            to: "/contributing/first-pr",
          },
          {
            from: "/misc/contributing/development-mode",
            to: "/contributing/guides/development-mode",
          },
          {
            from: "/misc/contributing/guides/development-mode",
            to: "/contributing/guides/development-mode",
          },
          {
            from: "/misc/contributing/guides/testing",
            to: "/contributing/guides/testing",
          },
          {
            from: "/misc/contributing/guides/formatting-and-linting",
            to: "/contributing/guides/formatting-and-linting",
          },
          // FAQ restructure redirects
          {
            from: "/misc/faq",
            to: "/faq",
          },
          // Prompt Engineering restructure redirects
          {
            from: "/prompt-engineering/overview",
            to: "/1.0/prompt-engineering/concepts",
          },
          {
            from: "/prompt-engineering/prompt-management/how-to-integrate-with-agenta",
            to: "/1.0/prompt-engineering/integrating-prompts/integrating-with-agenta",
          },
          {
            from: "/prompt-engineering/prompt-management/prompt-management-sdk",
            to: "/1.0/prompt-engineering/managing-prompts-programatically/create-and-commit",
          },
          {
            from: "/prompt-engineering/prompt-management/proxy-calls",
            to: "/1.0/prompt-engineering/integrating-prompts/proxy-calls",
          },
          {
            from: "/prompt-engineering/playground/using-the-playground",
            to: "/1.0/prompt-engineering/playground/using-playground",
          },
          {
            from: "/prompt-engineering/playground/adding-custom-providers",
            to: "/1.0/prompt-engineering/playground/custom-providers",
          },
          // Evaluation restructure redirects
          {
            from: "/evaluation/create-test-sets",
            to: "/1.0/evaluation/managing-test-sets/upload-csv",
          },
          {
            from: "/evaluation/no-code-evaluation",
            to: "/1.0/evaluation/evaluation-from-ui/running-evaluations",
          },
          {
            from: "/evaluation/sdk-evaluation",
            to: "/1.0/evaluation/concepts",
          },
          {
            from: "/evaluation/configure-evaluators",
            to: "/1.0/evaluation/configure-evaluators/overview",
          },
          {
            from: "/evaluation/human_evaluation",
            to: "/1.0/evaluation/human-evaluation/quick-start",
          },
          {
            from: "/evaluation/annotate-api",
            to: "/1.0/observability/trace-with-python-sdk/annotate-traces",
          },
          {
            from: "/evaluation/evaluators/classification-entiry-extraction",
            to: "/1.0/evaluation/configure-evaluators/classification-entity-extraction",
          },
          {
            from: "/evaluation/evaluators/pattern-matching",
            to: "/1.0/evaluation/configure-evaluators/regex-evaluator",
          },
          {
            from: "/evaluation/configure-evaluators/pattern-matching",
            to: "/1.0/evaluation/configure-evaluators/regex-evaluator",
          },
          {
            from: "/evaluation/evaluators/semantic-similarity",
            to: "/1.0/evaluation/configure-evaluators/semantic-similarity",
          },
          {
            from: "/evaluation/evaluators/llm-as-a-judge",
            to: "/1.0/evaluation/configure-evaluators/llm-as-a-judge",
          },
          {
            from: "/evaluation/evaluators/rag-evaluators",
            to: "/1.0/evaluation/configure-evaluators/rag-evaluators",
          },
          {
            from: "/evaluation/evaluators/custom-evaluator",
            to: "/1.0/evaluation/configure-evaluators/custom-evaluator",
          },
          {
            from: "/evaluation/evaluators/webhook-evaluator",
            to: "/1.0/evaluation/configure-evaluators/webhook-evaluator",
          },
          {
            from: "/evaluation/quick-start-ui",
            to: "/1.0/evaluation/evaluation-from-ui/quick-start",
          },
          {
            from: "/evaluation/quick-start-sdk",
            to: "/1.0/evaluation/concepts",
          },
          {
            from: "/evaluation/overview",
            to: "/1.0/evaluation/concepts",
          },
          // Observability restructure redirects
          {
            from: "/observability/observability-sdk",
            to: "/1.0/observability/trace-with-python-sdk/setup-tracing",
          },
          {
            from: "/observability/opentelemetry",
            to: "/1.0/observability/trace-with-opentelemetry/distributed-tracing",
          },
          {
            from: "/observability/otel-semconv",
            to: "/1.0/observability/trace-with-opentelemetry/semantic-conventions",
          },
          {
            from: "/observability/overview",
            to: "/1.0/observability/concepts",
          },
          {
            from: "/observability/quickstart",
            to: "/1.0/observability/quickstart-python",
          },
          {
            from: "/observability/trace-with-opentelemetry/setup-tracing",
            to: "/1.0/observability/trace-with-opentelemetry/getting-started",
          },
          {
            from: "/observability/using-the-ui/filtering-traces",
            to: "/1.0/observability/concepts",
          },
          {
            from: "/observability/concepts/semantic-conventions",
            to: "/1.0/observability/trace-with-opentelemetry/semantic-conventions",
          },
          {
            from: "/reference/api",
            to: "/reference/api/category",
          },
          // Observability integrations -> new Integrations section
          {
            from: "/observability/integrations/openai",
            to: "/1.0/integrations/llm-providers/openai/observability",
          },
          {
            from: "/observability/integrations/langchain",
            to: "/1.0/integrations/frameworks/langchain/observability",
          },
          {
            from: "/observability/integrations/instructor",
            to: "/1.0/integrations/libraries/instructor/observability",
          },
          {
            from: "/observability/integrations/litellm",
            to: "/1.0/integrations/llm-providers/litellm/observability",
          },
          {
            from: "/observability/integrations/llamaindex",
            to: "/1.0/integrations/frameworks/llamaindex/observability",
          },
          {
            from: "/observability/integrations/langgraph",
            to: "/1.0/integrations/frameworks/langgraph/observability",
          },
          {
            from: "/observability/integrations/openai-agents",
            to: "/1.0/integrations/frameworks/openai-agents/observability",
          },
          {
            from: "/observability/integrations/pydanticai",
            to: "/1.0/integrations/frameworks/pydanticai/observability",
          },
          {
            from: "/observability/integrations/dspy",
            to: "/1.0/integrations/frameworks/dspy/observability",
          },
          {
            from: "/observability/integrations/agno",
            to: "/1.0/integrations/frameworks/agno/observability",
          },
          {
            from: "/observability/integrations/google-adk",
            to: "/1.0/integrations/frameworks/google-adk/observability",
          }
        ],
        createRedirects(existingPath: string) {
          if (existingPath.includes('/reference/sdk/core_functions')) {
            return [
              existingPath.replace('reference/sdk/core_functions', 'reference/sdk/deprecated-v2/core_functions'),
            ];
          }
          // Every page of the frozen 1.0 documentation also answers at the URL
          // it had before versioning, so old links and search results keep
          // working.
          if (existingPath.startsWith('/1.0/')) {
            return [existingPath.replace('/1.0/', '/')];
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
    [
      "docusaurus-plugin-llms-txt",
      {
        title: "Agenta Documentation",
        description: "The open-source workspace for your agents — build them through chat, improve them with feedback, and share them with your team.",
        fullLLMsTxt: true,
      },
    ],
  ],

  clientModules: ["./src/clientModules/streamSkeleton.ts"],

  themes: ["docusaurus-theme-openapi-docs"],
};

export default async function createConfig() {
  return config;
}
