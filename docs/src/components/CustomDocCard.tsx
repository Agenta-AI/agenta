import React, {type ReactNode} from "react";
import DocCard from "@theme/DocCard";
import type {PropSidebarItem} from "@docusaurus/plugin-content-docs";

type Props = {
  item: PropSidebarItem;
  /** Kept for the v1.0 pages that pass it; cards no longer show an icon. */
  noIcon?: boolean;
};

/**
 * Used by the v1.0 docs (versioned_docs) to place a DocCard inline. The
 * emoji/image icon variants it once offered went with the docs redesign:
 * DocCard renders title and description only.
 */
export default function CustomDocCard({item}: Props): ReactNode {
  return <DocCard item={item} />;
}
