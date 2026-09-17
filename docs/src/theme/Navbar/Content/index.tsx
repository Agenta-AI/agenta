import React from 'react';
import {useThemeConfig, ErrorCauseBoundary} from '@docusaurus/theme-common';
import {
  splitNavbarItems,
  useNavbarMobileSidebar,
} from '@docusaurus/theme-common/internal';
import NavbarItem, {type Props as NavbarItemConfig} from '@theme/NavbarItem';
import NavbarColorModeToggle from '@theme/Navbar/ColorModeToggle';
import SearchBar from '@theme/SearchBar';
import NavbarMobileSidebarToggle from '@theme/Navbar/MobileSidebar/Toggle';
import NavbarLogo from '@theme/Navbar/Logo';
import NavbarSearch from '@theme/Navbar/Search';

import styles from './styles.module.css';

function useNavbarItems() {
  return useThemeConfig().navbar.items as NavbarItemConfig[];
}

function NavbarItems({items}: {items: NavbarItemConfig[]}): JSX.Element {
  return (
    <>
      {items.map((item, i) => (
        <ErrorCauseBoundary
          key={i}
          onError={(error) =>
            new Error(
              `A theme navbar item failed to render.
Please double-check the following navbar item (themeConfig.navbar.items) of your Docusaurus config:
${JSON.stringify(item, null, 2)}`,
              {cause: error},
            )
          }>
          <NavbarItem {...item} />
        </ErrorCauseBoundary>
      ))}
    </>
  );
}

/**
 * One header row: logo and version on the left, search, theme toggle and the
 * CTAs on the right. The section links (position: "left") are not rendered
 * here; the sidebar rail shows them on desktop and the hamburger menu on
 * mobile. Social links live in the footer.
 */
export default function NavbarContent(): JSX.Element {
  const mobileSidebar = useNavbarMobileSidebar();

  const items = useNavbarItems();
  const versionItems = items.filter(
    (item) => item.type === 'docsVersionDropdown',
  );
  const [, rightItems] = splitNavbarItems(
    items.filter((item) => item.type !== 'docsVersionDropdown'),
  );
  // Search is placed explicitly, before the action buttons.
  const actionItems = rightItems.filter((item) => item.type !== 'search');

  return (
    <div className="navbar__inner">
      <div className={styles.left}>
        {!mobileSidebar.disabled && <NavbarMobileSidebarToggle />}
        <NavbarLogo />
        {versionItems.length > 0 && (
          <div className={styles.versionSelector}>
            <NavbarItems items={versionItems} />
          </div>
        )}
      </div>
      <div className={styles.right}>
        <NavbarSearch className={styles.search}>
          <SearchBar />
        </NavbarSearch>
        <div className={styles.icons}>
          <NavbarColorModeToggle className={styles.colorModeToggle} />
        </div>
        <div className={styles.actions}>
          <NavbarItems items={actionItems} />
        </div>
      </div>
    </div>
  );
}
