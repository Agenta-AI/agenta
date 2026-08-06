import React, {type ReactNode} from "react";
import Link from "@docusaurus/Link";
import {useBlogPost} from "@docusaurus/plugin-content-blog/client";
import BlogPostItem from "@theme-original/BlogPostItem";
import type BlogPostItemType from "@theme/BlogPostItem";
import type {WrapperProps} from "@docusaurus/types";
import Heading from "@theme/Heading";
import MDXContent from "@theme/MDXContent";

import styles from "./styles.module.css";

type Props = WrapperProps<typeof BlogPostItemType>;

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Changelog-style list item: date and version in a left meta column,
 * linked title and (truncated) content on the right.
 */
function ChangelogItem({children}: {children: ReactNode}): ReactNode {
  const {metadata} = useBlogPost();
  const {permalink, title, date, tags, hasTruncateMarker} = metadata;
  const version = tags.find((tag) => /^v\d/.test(tag.label))?.label;

  return (
    <article className={styles.item}>
      <div className={styles.meta}>
        <time dateTime={date} className={styles.date}>
          {dateFormatter.format(new Date(date))}
        </time>
        {version && <span className={styles.version}>{version}</span>}
      </div>
      <div className={styles.main}>
        <Heading as="h2" className={styles.title}>
          <Link to={permalink}>{title}</Link>
        </Heading>
        <div className="markdown">
          <MDXContent>{children}</MDXContent>
        </div>
        {hasTruncateMarker && (
          <Link
            to={permalink}
            className={styles.readMore}
            aria-label={`Read more about ${title}`}>
            Read more →
          </Link>
        )}
      </div>
    </article>
  );
}

export default function BlogPostItemWrapper(props: Props): ReactNode {
  const {isBlogPostPage} = useBlogPost();
  if (isBlogPostPage) {
    return <BlogPostItem {...props} />;
  }
  return <ChangelogItem>{props.children}</ChangelogItem>;
}
