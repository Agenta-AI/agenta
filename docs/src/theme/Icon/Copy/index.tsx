/**
 * Ejected from @docusaurus/theme-classic: the code block's copy icon, drawn
 * as two overlapping outlined squares (stroke style, like the sidebar icons)
 * instead of the filled default.
 */
import React, {type ReactNode} from 'react';
import type {Props} from '@theme/Icon/Copy';

export default function IconCopy(props: Props): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}>
      <rect x="9" y="9" width="12" height="12" rx="1.5" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}
