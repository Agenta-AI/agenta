import React, {type ReactNode} from "react";
import {useBlogPost} from "@docusaurus/plugin-content-blog/client";
import {formatDate} from "@site/src/utils/formatDate";

import styles from "./styles.module.css";

/** The entry's date with its release version beside it, in place of the footer tags. */
export default function BlogPostItemHeaderInfo(): ReactNode {
  const {metadata} = useBlogPost();
  const version = metadata.tags.find((tag) => /^v\d/.test(tag.label))?.label;
  return (
    <div className={`margin-vert--md ${styles.info}`}>
      <time dateTime={metadata.date}>{formatDate(metadata.date)}</time>
      {version && <span className="versionChip">{version}</span>}
    </div>
  );
}
