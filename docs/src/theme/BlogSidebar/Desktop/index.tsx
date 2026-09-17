/**
 * Ejected from @docusaurus/theme-classic: the "Releases" list under the
 * section rail. One row per entry; long titles wrap to a second line.
 */
import React, {memo, type ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import {useVisibleBlogSidebarItems} from '@docusaurus/plugin-content-blog/client';
import type {Props} from '@theme/BlogSidebar/Desktop';
import {SidebarGroup} from '@site/src/components/SidebarShell';

import styles from './styles.module.css';

function BlogSidebarDesktop({sidebar}: Props): ReactNode {
  const items = useVisibleBlogSidebarItems(sidebar.items);
  return (
    <SidebarGroup title={sidebar.title}>
      {items.map((item) => (
        <li key={item.permalink} className="menu__list-item">
          <Link
            isNavLink
            to={item.permalink}
            className={clsx('menu__link', styles.link)}
            activeClassName="menu__link--active">
            {item.title}
          </Link>
        </li>
      ))}
    </SidebarGroup>
  );
}

export default memo(BlogSidebarDesktop);
