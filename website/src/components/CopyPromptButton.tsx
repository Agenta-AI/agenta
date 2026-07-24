import { useRef, useState } from "react";

/*
 * CopyPromptButton — the terminal card's "Copy prompt" control (Open source
 * section). Copies the full paste-into-Claude-Code prompt to the clipboard and
 * flips its label to "Copied" for 1.6s, then back. Ported from the design's
 * ossCopyPrompt() handler. Kept tiny: the button's chrome is passed in as
 * children/props so the styling stays in the Astro markup.
 */

// Verbatim prompt text from the design source (ossCopyPrompt).
const PROMPT =
  "Paste this into Claude Code (or your coding agent) and it will walk you through setup and testing:\n1. Install the Agenta self-hosting skill: npx skills add Agenta-AI/agenta-skills\n2. Help me self-host Agenta with its repository.";

export default function CopyPromptButton() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(PROMPT);
    } catch {
      // Clipboard blocked/unavailable — leave the label unchanged rather than
      // claiming success.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 26,
        padding: "0 10px",
        borderRadius: 7,
        border: "none",
        background: "rgba(255,255,255,0.05)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
        font: "500 11.5px/1 var(--font-sans)",
        color: "rgba(255,255,255,0.7)",
        cursor: "pointer",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="14" height="14" x="8" y="8" rx="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
      {copied ? "Copied" : "Copy prompt"}
    </button>
  );
}
