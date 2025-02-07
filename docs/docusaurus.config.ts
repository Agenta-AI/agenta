// @ts-check
import { themes as prismThemes } from "prism-react-renderer";
import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import type * as Plugin from "@docusaurus/types/src/plugin";
import type * as OpenApiPlugin from "docusaurus-plugin-openapi-docs";
import "dotenv/config";

const config: Config = {
  title: "Agenta Documentation",
  tagline: "The LLMOps platform.",
  favicon: "images/favicon.ico",
  // Set the production url of your site here
  url: "https://docs.agenta.ai",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/",
  organizationName: "Agenta-AI",
  projectName: "agenta",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "throw",
  onBrokenAnchors: "throw",

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  scripts: [
    
    {
      src: 'https://www.googletagmanager.com/gtag/js?id=G-LTF78FZS33',
      async: true,
    },
    {
      src: '/ga-script.js',
      async: true,
    },{
      src:"/hotjar.js",
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
    // Replace with your project's social card
    image: "images/simple-img.png",
    docs: {
      sidebar: {
        hideable: false,
        autoCollapseCategories: false,
      },
    },
    navbar: {
      logo: {
        alt: "agenta-ai",
        src: "images/light-complete-transparent-CROPPED.png",
        srcDark: "images/dark-complete-transparent-CROPPED.png",
      },
      hideOnScroll: false,
      items: [
        {
          type: "doc",
          sidebarId: "docsSidebar",
          docId: "getting-started/introduction",
          position: "left",
          label: "Docs",
        },
        {
          type: "docSidebar",
          sidebarId: "guidesSidebar",
          position: "left",
          label: "Tutorials",
        },
        {
          type: "docSidebar",
          sidebarId: "refrenceSidebar",
          position: "left",
          label: "Reference",
        },
        {
          to: "/changelog/main",
          position: "left",
          label: "Changelog",
        },
        {
          to: "https://agenta.ai/pricing",
          position: "left",
          label: "Pricing",
        },
        {
          to: "https://agenta.ai/blog",
          position: "left",
          label: "Blog",
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
          href: "https://join.slack.com/t/agenta-hq/shared_invite/zt-2yewk6o2b-DmhyA4h_lkKwecDtIsj1AQ",
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
        appUrl: "https://docs.agenta.ai",
        enableInDevelopment: false, // optional
        api_host: "https://app.posthog.com",
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
        from: "/reference/sdk/quick_start",
        to: "/reference/sdk/deprecated-v2/quick_start",
      },
      {
        from: "/reference/cli/quick-usage",
        to: "/reference/cli/cli-reference",
      },
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
