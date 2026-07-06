import { useEffect, useState } from "react";
import { ARTICLE_SECTIONS } from "./content";

// Computed once at module scope (ARTICLE_SECTIONS is a fixed constant), so
// the id list passed to useActiveSection is referentially stable across
// renders. Otherwise TableOfContents re-derives it with `.map` on every
// render, and the observer effect below (keyed on `ids`) tears down and
// recreates its IntersectionObserver every time, instead of once.
const SECTION_IDS = ARTICLE_SECTIONS.map((s) => s.id);

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

function TableOfContents() {
  const active = useActiveSection(SECTION_IDS);

  return (
    <nav className="article-toc" aria-label="Table of contents">
      {ARTICLE_SECTIONS.map((section) => (
        <a key={section.id} href={`#${section.id}`} className={section.id === active ? "active" : undefined}>
          {section.tocLabel}
        </a>
      ))}
    </nav>
  );
}

export function App() {
  return (
    <>
      <div className="narrow-warning">
        This article is built for wide screens (1100px+). Some figures may be cramped below that.
      </div>
      <header className="article-header">
        <p className="kicker">Agent workflows, explained</p>
        <h1>How a request becomes an agent run</h1>
        <p className="dek">
          One scrollable article, one recurring character: the request. Figures let you click,
          scrub, and replay every hop it takes.
        </p>
      </header>
      <div className="article-body">
        <TableOfContents />
        <main>
          {ARTICLE_SECTIONS.map(({ id, Component }) => (
            <Component key={id} />
          ))}
        </main>
      </div>
    </>
  );
}
