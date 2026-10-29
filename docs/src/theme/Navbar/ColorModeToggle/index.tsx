/**
 * Ejected from @docusaurus/theme-classic: the light/dark toggle used in the
 * header and in the hamburger drawer's header. One 32px ghost icon button
 * that flips the mode; the footer has the three-way system/light/dark switch.
 */
import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {useColorMode} from '@docusaurus/theme-common';
import type {Props} from '@theme/Navbar/ColorModeToggle';

import styles from './styles.module.css';

export default function NavbarColorModeToggle({className}: Props): ReactNode {
  const {colorMode, setColorMode} = useColorMode();
  const next = colorMode === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={clsx(styles.toggle, className)}
      onClick={() => setColorMode(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </svg>
    </button>
  );
}
