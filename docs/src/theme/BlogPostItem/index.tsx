import React, {type ReactNode} from "react";
import Link from "@docusaurus/Link";
import {useBlogPost} from "@docusaurus/plugin-content-blog/client";
import useBrokenLinks from "@docusaurus/useBrokenLinks";
import BlogPostItem from "@theme-original/BlogPostItem";
import type BlogPostItemType from "@theme/BlogPostItem";
import type {WrapperProps} from "@docusaurus/types";
import Heading from "@theme/Heading";
import MDXContent from "@theme/MDXContent";
import {formatDate} from "@site/src/utils/formatDate";

import styles from "./styles.module.css";

type Props = WrapperProps<typeof BlogPostItemType>;

interface ReleaseItem {
  area: string;
  text: string;
}

const asItems = (value: unknown): ReleaseItem[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is ReleaseItem =>
          typeof item?.area === "string" && typeof item?.text === "string",
      )
    : [];

function ReleaseItemsSection({
  title,
  items,
}: {
  title: string;
  items: ReleaseItem[];
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <details className={styles.releaseSection} open>
      <summary className={styles.releaseSummary}>
        <span>{title}</span>
        <span className={styles.releaseCount}>{items.length}</span>
        <svg
          className={styles.releaseChevron}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <ul className={styles.releaseList}>
        {items.map((item, index) => (
          <li key={`${item.area}-${index}`} className={styles.releaseRow}>
            <span className={styles.releaseArea}>{item.area}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const RELEASE_ITEMS_ID = "improvements-and-fixes";

function useReleaseItems() {
  const data = useBlogPost().frontMatter as Record<string, unknown>;
  return {improvements: asItems(data.improvements), fixes: asItems(data.fixes)};
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** The entry's `improvements` and `fixes` frontmatter, after its content. */
function ReleaseItems(): ReactNode {
  const {improvements, fixes} = useReleaseItems();
  useBrokenLinks().collectAnchor(RELEASE_ITEMS_ID);
  if (improvements.length === 0 && fixes.length === 0) return null;
  return (
    <div id={RELEASE_ITEMS_ID} className={styles.releaseItems}>
      <ReleaseItemsSection title="Improvements" items={improvements} />
      <ReleaseItemsSection title="Fixes" items={fixes} />
    </div>
  );
}

/** One line on the list page saying the entry also carries smaller changes. */
function ReleaseItemsHint({permalink}: {permalink: string}): ReactNode {
  const {improvements, fixes} = useReleaseItems();
  if (improvements.length === 0 && fixes.length === 0) return null;
  const counts = [
    improvements.length > 0 &&
      plural(improvements.length, "improvement", "improvements"),
    fixes.length > 0 && plural(fixes.length, "fix", "fixes"),
  ].filter(Boolean);
  return (
    <Link to={`${permalink}#${RELEASE_ITEMS_ID}`} className={styles.releaseHint}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span>{counts.join(" and ")} in this release</span>
    </Link>
  );
}

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
          {formatDate(date)}
        </time>
        {version && <span className="versionChip">{version}</span>}
      </div>
      <div className={styles.main}>
        <Heading as="h2" className={styles.title}>
          <Link to={permalink}>{title}</Link>
        </Heading>
        <div className="markdown">
          <MDXContent>{children}</MDXContent>
        </div>
        <ReleaseItemsHint permalink={permalink} />
        {hasTruncateMarker && (
          <Link
            to={permalink}
            className={styles.readMore}
            aria-label={`Read more about ${title}`}>
            <span>Read more</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true">
              <line x1="4" y1="12" x2="19" y2="12" />
              <polyline points="13 6 19 12 13 18" />
            </svg>
          </Link>
        )}
      </div>
    </article>
  );
}

export default function BlogPostItemWrapper(props: Props): ReactNode {
  const {isBlogPostPage} = useBlogPost();
  if (isBlogPostPage) {
    return (
      <BlogPostItem {...props}>
        {props.children}
        <ReleaseItems />
      </BlogPostItem>
    );
  }
  return <ChangelogItem>{props.children}</ChangelogItem>;
}
