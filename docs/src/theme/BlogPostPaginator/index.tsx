import React, {type ReactNode} from "react";
import Link from "@docusaurus/Link";
import PaginatorNavLink from "@theme/PaginatorNavLink";
import type {Props} from "@theme/BlogPostPaginator";

import styles from "./styles.module.css";

/** A way back to the changelog on the left, the newer and older entries on the right. */
export default function BlogPostPaginator({nextItem, prevItem}: Props): ReactNode {
  return (
    <nav className="pagination-nav docusaurus-mt-lg" aria-label="Changelog navigation">
      <Link
        to="/changelog"
        className="pagination-nav__link pagination-nav__link--prev">
        <div className="pagination-nav__label">All releases</div>
      </Link>
      <div className={styles.neighbors}>
        {prevItem && (
          <PaginatorNavLink permalink={prevItem.permalink} title="Newer" />
        )}
        {nextItem && (
          <PaginatorNavLink permalink={nextItem.permalink} title="Older" isNext />
        )}
      </div>
    </nav>
  );
}
