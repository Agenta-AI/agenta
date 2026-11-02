/**
 * Length cuts that never split a UTF-16 surrogate pair. `String.prototype.slice` counts code
 * units, so a cut through an emoji or a styled letter ("𝗰") leaves a lone surrogate.
 * `JSON.stringify` writes that as `\ud835`, and the sandbox-agent daemon (serde_json) rejects
 * the whole request body, so every later turn that replays the text fails too.
 */

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The first `max` code units of `text`, one shorter when the cut would split a pair. */
export function headCut(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max);
}

/** The last `max` code units of `text`, one shorter when the cut would split a pair. */
export function tailCut(text: string, max: number): string {
  if (text.length <= max) return text;
  const start = text.length - max;
  return text.slice(isLowSurrogate(text.charCodeAt(start)) ? start + 1 : start);
}
