import type { ReactNode } from "react";

export interface SectionProps {
  id: string;
  index: string;
  title: string;
  children: ReactNode;
}

export function Section({ id, index, title, children }: SectionProps) {
  return (
    <section className="article-section" id={id}>
      <div className="section-index">{index}</div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** A short placeholder paragraph, replaced by a dedicated writer later. */
export function ProseTk({ children }: { children: ReactNode }) {
  return (
    <p className="prose-tk">
      {/* PROSE-TK */}
      {children}
    </p>
  );
}

export function FigureBreak({ children }: { children: ReactNode }) {
  return <div className="figure-break">{children}</div>;
}
