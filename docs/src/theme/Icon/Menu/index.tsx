import React, {type ReactNode} from 'react';
import type {Props} from '@theme/Icon/Menu';

/**
 * Hamburger as two short bars instead of the theme's three-line 30px glyph.
 * The bars are plain spans so navbar.css can size and colour them with the
 * rest of the header.
 */
export default function IconMenu(_props: Props): ReactNode {
  return (
    <span className="menuToggle" aria-hidden="true">
      <span className="menuToggleBars">
        <span />
        <span />
      </span>
    </span>
  );
}
