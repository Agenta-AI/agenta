import { useState, type CSSProperties } from "react";

/*
 * CategoryFilter — a small React island (client:visible) for the blog index.
 *
 * The post grid is fully server-rendered (every card carries a `data-category`
 * attribute and is correct before hydration). This island only flips a
 * `data-filter` attribute on the grid root (`#blog-grid`); CSS in the page hides
 * the non-matching cards. So filtering needs no client-side list rebuild and the
 * page works with JS disabled (shows all posts = the "All" state).
 *
 * Accessibility: a tablist of pills; left/right arrows move + select; the active
 * pill is the only one in the tab order (roving tabindex).
 */

interface Props {
  categories: string[]; // e.g. ["All", "Engineering", "Article"]
  targetId?: string;
}

export default function CategoryFilter({
  categories,
  targetId = "blog-grid",
}: Props) {
  const [active, setActive] = useState<string>(categories[0] ?? "All");

  const select = (cat: string) => {
    setActive(cat);
    document.getElementById(targetId)?.setAttribute("data-filter", cat);
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % categories.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + categories.length) % categories.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = categories.length - 1;
    else return;
    e.preventDefault();
    select(categories[next]);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    height: 34,
    padding: "0 16px",
    borderRadius: 999,
    font: "var(--text-label)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    border: "none",
    transition: "all 0.12s",
  };
  const on: CSSProperties = {
    ...base,
    background: "var(--yellow-400)",
    color: "var(--ink-900)",
    boxShadow: "var(--shadow-btn-primary)",
  };
  const off: CSSProperties = {
    ...base,
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.72)",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
  };

  return (
    <div role="tablist" aria-label="Filter posts by category" style={{ display: "flex", gap: 8 }}>
      {categories.map((cat, i) => (
        <button
          key={cat}
          type="button"
          role="tab"
          aria-selected={active === cat}
          tabIndex={active === cat ? 0 : -1}
          onClick={() => select(cat)}
          onKeyDown={(e) => onKeyDown(e, i)}
          style={active === cat ? on : off}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
