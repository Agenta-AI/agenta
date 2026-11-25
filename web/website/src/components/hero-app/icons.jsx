// The few glyphs the app draws with lucide-react (everything else is Phosphor).
// Paths are lucide's, so the mockup matches the app without the dependency.
const L = ({ size = 16, children, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    {children}
  </svg>
);

/** lucide Bot: the Agents row and the agent kind badge. */
export const BotIcon = (p) => (
  <L {...p}>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
  </L>
);

/** lucide Sparkle: BuilderIcon in @agenta/ui/agent-icon. */
export const BuilderIcon = (p) => (
  <L {...p}>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  </L>
);

/** lucide ChartColumn: the agent sidebar's Analytics row. */
export const ChartColumnIcon = (p) => (
  <L {...p}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3" />
  </L>
);

/** lucide FoldVertical: "Back to the main sidebar". */
export const FoldIcon = (p) => (
  <L {...p}>
    <path d="M12 22v-6M12 8V2M4 12H2M10 12H8M16 12h-2M22 12h-2m-7 7-3-3-3 3m6-14-3 3-3-3" />
  </L>
);

/** lucide UnfoldVertical: open an agent from its sidebar heading. */
export const UnfoldIcon = (p) => (
  <L {...p}>
    <path d="M12 22v-6M12 8V2M4 12H2M10 12H8M16 12h-2M22 12h-2m-7 7-3 3-3-3m6-14-3-3-3 3" />
  </L>
);

/** The builder's empty-state orbit, drawn from the design canvas picture. */
export const OrbArt = ({ width = 180, height = 125 }) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 520 360"
    aria-hidden="true"
    className="hx-orb"
  >
    <ellipse
      cx="260"
      cy="160"
      rx="146"
      ry="128"
      fill="none"
      stroke="currentColor"
      strokeOpacity=".38"
      strokeWidth="5"
      strokeLinecap="round"
      strokeDasharray="0 11"
    />
    <ellipse
      cx="248"
      cy="190"
      rx="84"
      ry="102"
      transform="rotate(-24 248 190)"
      fill="none"
      stroke="currentColor"
      strokeOpacity=".24"
      strokeWidth="4"
      strokeLinecap="round"
      strokeDasharray="0 9"
    />
    <circle cx="262" cy="32" r="11" fill="currentColor" fillOpacity=".85" />
    <circle cx="143" cy="236" r="8.5" fill="currentColor" fillOpacity=".75" />
    <circle cx="374" cy="239" r="8.5" fill="currentColor" fillOpacity=".75" />
  </svg>
);
