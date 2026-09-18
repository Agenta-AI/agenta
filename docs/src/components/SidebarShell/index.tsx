import React, { type ReactNode } from "react";
import clsx from "clsx";
import SectionRail from "@site/src/components/SectionRail";

import styles from "./styles.module.css";

type ShellProps = {
  /** Sidebar groups rendered under the section rail. */
  sidebar?: ReactNode;
  children: ReactNode;
};

/**
 * The docs frame for pages the docs plugin does not lay out (changelog,
 * roadmap): a sticky 272px sidebar with the section rail, and a main column
 * with the same padding the doc pages get. Widths come from tokens.css so the
 * two layouts stay aligned.
 */
export default function SidebarShell({ sidebar, children }: ShellProps): ReactNode {
  return (
    <div className={clsx("sidebarShell", styles.shell)}>
      <aside className={styles.sidebar}>
        <div className={clsx("sidebarShellMenu thin-scrollbar", styles.menu)}>
          <SectionRail />
          {sidebar}
        </div>
      </aside>
      <main className={clsx("sidebarShellMain", styles.main)}>
        <div className="container">{children}</div>
      </main>
    </div>
  );
}

type GroupProps = {
  title: string;
  children: ReactNode;
};

/** A titled list in the sidebar, like a docs sidebar category. */
export function SidebarGroup({ title, children }: GroupProps): ReactNode {
  return (
    <div className="sidebarGroup">
      <div className="sidebarGroupTitle">{title}</div>
      <ul className="menu__list">{children}</ul>
    </div>
  );
}
