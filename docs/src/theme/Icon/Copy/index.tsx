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
      <path d="M7 9.667A2.667 2.667 0 0 1 9.667 7h8.666A2.667 2.667 0 0 1 21 9.667v8.666A2.667 2.667 0 0 1 18.333 21H9.667A2.667 2.667 0 0 1 7 18.333z" />
      <path d="M4.012 16.737A2.005 2.005 0 0 1 3 15V5c0-1.1.9-2 2-2h10c.75 0 1.158.385 1.5 1" />
    </svg>
  );
}
