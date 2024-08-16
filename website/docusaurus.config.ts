import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "Agenta Documentation",
  tagline: "Agenta: The LLMOps platform.",
  favicon: "img/favicon.ico",
  // Set the production url of your site here
  url: "https://your-docusaurus-site.example.com",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/",
  organizationName: "Agenta-AI",
  projectName: "agenta",
  onBrokenLinks: "throw",
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
          editUrl: "https://github.com/Agenta-AI/agenta/tree/main/packages/create-docusaurus/templates/shared/",
        },
        blog: {
          routeBasePath: "/changelog",
          showReadingTime: false,
          feedOptions: {
            type: ["rss", "atom"],
            xslt: true,
          },
          blogSidebarCount: 0,
          editUrl: "https://github.com/Agenta-AI/agenta/tree/main/packages/create-docusaurus/templates/shared/",
          onInlineTags: "ignore",
          onInlineAuthors: "ignore",
          onUntruncatedBlogPosts: "ignore",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: "img/simple-img.png",
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    navbar: {
      title: "agenta",
      logo: {
        alt: "agenta-ai",
        src: "img/light-logo.svg",
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
          label: "Refrence",
        },
        {
          to: "/changelog/changes",
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
          href: "https://github.com/facebook/docusaurus",
          label: "GitHub",
          position: "right",
        },
        {
          href: "https://github.com/facebook/docusaurus",
          label: "Slack",
          position: "right",
        },
        {
          href: "https://github.com/facebook/docusaurus",
          label: "Book A Demo",
          position: "right",
        },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
    algolia: {
      // The application ID provided by Algolia
      appId: "OUSV9KGN15",
      // Public API key: it is safe to commit it
      apiKey: "87468b00a479e707410f7b2b05ef6f9b",
      indexName: "YOUR_INDEX_NAME",
      // Optional: see doc section below
      contextualSearch: true,
      // Optional: Specify domains where the navigation should occur through window.location instead on history.push. Useful when our Algolia config crawls multiple documentation sites and we want to navigate with window.location.href to them.
      externalUrlRegex: "external\\.com|domain\\.com",
      // Optional: Replace parts of the item URLs from Algolia. Useful when using the same search index for multiple deployments using a different baseUrl. You can use regexp or string in the `from` param. For example: localhost:3000 vs myCompany.com/docs
      replaceSearchResultPathname: {
        from: "/docs/", // or as RegExp: /\/docs\//
        to: "/",
      },
      // Optional: Algolia search parameters
      searchParameters: {},
      // Optional: path for search page that enabled by default (`false` to disable it)
      searchPagePath: "search",
      // Optional: whether the insights feature is enabled or not on Docsearch (`false` by default)
      insights: false,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
