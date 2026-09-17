import React, {type ReactNode} from "react";
import MDXComponents from "@theme-original/MDXComponents";
import {useBlogPost} from "@docusaurus/plugin-content-blog/client";
import Video from "@site/src/components/Video";

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

/**
 * Markdown tables in a scroll container: the table itself spans the reading
 * column (content.css), and one that is wider than the column scrolls
 * sideways instead of running under the "On this page" column.
 */
function Table(props: React.ComponentProps<"table">): ReactNode {
  return (
    <div className="tableScroll">
      <table {...props} />
    </div>
  );
}

export default {
  ...MDXComponents,
  Summary,
  Video,
  table: Table,
};
