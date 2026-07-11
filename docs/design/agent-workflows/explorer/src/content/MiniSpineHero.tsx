import { motion } from "motion/react";

const TIERS: { id: string; label: string }[] = [
  { id: "edge", label: "edge" },
  { id: "service", label: "service" },
  { id: "runner", label: "runner" },
  { id: "sandbox", label: "sandbox" },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.18 } },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

/** Purely decorative: one request, one spine, no figure interaction (§0 has no F-numbered figure). */
export function MiniSpineHero() {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={container}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        fontFamily: "var(--font-sans)",
        fontSize: "0.85rem",
        margin: "1.5rem 0",
      }}
    >
      {TIERS.map((tier, i) => (
        <motion.span key={tier.id} variants={item} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "4px 10px",
              borderRadius: "999px",
              border: `1.5px solid var(--tier-${tier.id})`,
              color: `var(--tier-${tier.id})`,
            }}
          >
            {tier.label}
          </span>
          {i < TIERS.length - 1 && <span style={{ color: "var(--color-text-muted)" }}>&rarr;</span>}
        </motion.span>
      ))}
    </motion.div>
  );
}
