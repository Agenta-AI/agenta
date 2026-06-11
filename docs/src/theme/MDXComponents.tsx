import React, {type ReactNode} from "react";
import MDXComponents from "@theme-original/MDXComponents";
import {useBlogPost} from "@docusaurus/plugin-content-blog/client";

/**
 * Changelog short summary. Renders only in the blog list (the /changelog
 * index), where it serves as the entry's preview. On the entry's own page it
 * renders nothing, so the page shows just the full write-up below the
 * {/* truncate *​/} marker without repeating the summary.
 *
 * Only changelog entries use <Summary>, so useBlogPost() always runs inside a
 * BlogPostProvider here.
 */
function Summary({children}: {children: ReactNode}): ReactNode {
  const {isBlogPostPage} = useBlogPost();
  return isBlogPostPage ? null : <>{children}</>;
}

export default {
  ...MDXComponents,
  Summary,
};
