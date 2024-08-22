// @ts-check
import { themes as prismThemes } from "prism-react-renderer";
import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import type * as Plugin from "@docusaurus/types/src/plugin";
import type * as OpenApiPlugin from "docusaurus-plugin-openapi-docs";

const config: Config = {
  title: "Agenta Documentation",
  tagline: "Agenta: The LLMOps platform.",
  favicon: "images/favicon.ico",
  // Set the production url of your site here
  url: "https://your-docusaurus-site.example.com",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/",
  organizationName: "Agenta-AI",
  projectName: "agenta",
  onBrokenLinks: "ignore",
  onBrokenMarkdownLinks: "warn",

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          path: "docs",
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/Agenta-AI/agenta/tree/main/websites",
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
          editUrl: "https://github.com/Agenta-AI/agenta/tree/main/websites",
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
          docId: "getting_started/introduction",
          position: "left",
          label: "Documentation",
        },
        {
          type: "docSidebar",
          sidebarId: "guidesSidebar",
          position: "left",
          label: "Guides",
        },
        {
          type: "docSidebar",
          sidebarId: "refrenceSidebar",
          position: "left",
          label: "Reference",
        },
        {
          to: "/changelog",
          position: "left",
          label: "Changelog",
        },
        {
          to: "https://github.com/orgs/Agenta-AI/projects/13/views/1",
          position: "left",
          label: "Roadmap",
        },
        // nav social links
        {
          type: "search",
          position: "right",
        },
        {
          href: "https://github.com/Agenta-AI/agenta",
          label: "GitHub",
          position: "right",
          class: "nav_social_links",
        },
        {
          href: "https://agenta-hq.slack.com/join/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA",
          label: "Slack",
          position: "right",
          class: "nav_social_links",
        },
        {
          href: "https://cal.com/mahmoud-mabrouk-ogzgey/demo",
          label: "Book A Demo",
          position: "right",
          class: "nav_social_links",
        },
        {
          href: "https://cloud.agenta.ai/apps",
          label: "Start for Free",
          position: "right",
          class: "nav_social_links",
        },
        {
          href: "https://cal.com/mahmoud-mabrouk-ogzgey/demo",
          position: "right",
          html: "<button class='nav_secondary_button'>Book A Demo</button",
        },
        {
          href: "https://cloud.agenta.ai/apps",
          position: "right",
          html: "<button class='nav_primary_button'>Start for Free</button",
        },
      ],
    },
    prism: {
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
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
      appId: "BEKE35D93N",
      apiKey: "d760ee239785f6acd72ea26185681706",
      indexName: "agenta-ai",
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
              "https://raw.githubusercontent.com/PaloAltoNetworks/docusaurus-template-openapi-docs/main/examples/agenta.yaml",
            sidebarOptions: {
              groupPathsBy: "tag",
              categoryLinkSource: "tag",
            },
          } satisfies OpenApiPlugin.Options,
        } satisfies Plugin.PluginOptions,
      },
    ],
    "docusaurus-plugin-image-zoom",
  ],

  themes: ["docusaurus-theme-openapi-docs"],
};

export default async function createConfig() {
  return config;
}
