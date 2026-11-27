/**
 * @agenta/ui/layout — the page frame and its scroll parts: page width and gutter, PageLayout,
 * the tab title, HeightCollapse, the scroll sentinel and scroll-to-top button, the panel layouts
 * and the config sections.
 */
export {HeightCollapse, type HeightCollapseProps} from "./HeightCollapse"
export {default as PageLayout, type PageLayoutProps} from "./PageLayout"
export {PageTitle, type PageTitleProps} from "./page-title"
export {pageContentWidthClass, pageGutterClass} from "./pageWidth"
export {default as ScrollSentinel} from "./ScrollSentinel"
export {default as ScrollToTopButton} from "./ScrollToTopButton"
export * from "./panel"
export * from "./section"
