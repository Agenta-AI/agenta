/**
 * Ejected from @docusaurus/theme-classic so the changelog sits in the same
 * frame as the docs (section rail + sidebar on the left, reading column on
 * the right) instead of the stock centred three-column grid.
 */
import React, {type ReactNode} from 'react';
import Layout from '@theme/Layout';
import BlogSidebar from '@theme/BlogSidebar';
import type {Props} from '@theme/BlogLayout';
import SidebarShell from '@site/src/components/SidebarShell';

export default function BlogLayout(props: Props): ReactNode {
  const {sidebar, toc, children, ...layoutProps} = props;

  return (
    <Layout {...layoutProps}>
      <SidebarShell sidebar={sidebar && <BlogSidebar sidebar={sidebar} />}>
        {children}
        {toc}
      </SidebarShell>
    </Layout>
  );
}
