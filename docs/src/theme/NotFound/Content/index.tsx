import React, { type ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import Translate from "@docusaurus/Translate";
import { HtmlClassNameProvider } from "@docusaurus/theme-common";
import Heading from "@theme/Heading";
import SidebarShell from "@site/src/components/SidebarShell";

import styles from "./styles.module.css";

type Props = {
  className?: string;
};

/**
 * The 404 page in the docs frame: section rail on the left, the message in
 * the reading column, and a way forward. The docs plugin renders this for
 * unknown doc paths, the site for everything else; both get the same frame.
 */
export default function NotFoundContent({ className }: Props): ReactNode {
  return (
    <HtmlClassNameProvider className="not-found-page">
      <SidebarShell>
        <div className={clsx(styles.notFound, className)}>
          <p className={styles.code}>404</p>
          <Heading as="h1" className={styles.title}>
            <Translate id="theme.NotFound.title" description="The title of the 404 page">
              Page not found
            </Translate>
          </Heading>
          <p className={styles.lead}>
            <Translate id="theme.NotFound.p1" description="The first paragraph of the 404 page">
              The page you are looking for was moved, renamed, or never existed.
            </Translate>
          </p>
          <div className={styles.actions}>
            <Link className="nav_primary_button" to="/">
              Go to the docs
            </Link>
            <Link className="nav_secondary_button" to="/changelog">
              See what changed
            </Link>
          </div>
          <p className={styles.hint}>
            <Translate id="theme.NotFound.p2" description="The 2nd paragraph of the 404 page">
              If a link on the site brought you here, let us know so we can fix it.
            </Translate>{" "}
            <Link href="https://github.com/Agenta-AI/agenta/issues/new">Report a broken link</Link>
          </p>
        </div>
      </SidebarShell>
    </HtmlClassNameProvider>
  );
}
