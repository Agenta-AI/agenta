/**
 * Cloudflare Stream paints nothing until its player boots, so the embed's box sits empty
 * on a slow connection. Mark each embed's wrapper while it loads; custom.css draws the
 * skeleton off that attribute and drops it once the frame reports in.
 *
 * Driven off the iframe rather than the <Stream> component so the raw <iframe> embeds in
 * the changelog get the same treatment.
 */
const STREAM_IFRAME = 'iframe[src*="cloudflarestream"]';

function markPendingEmbeds(): void {
  document.querySelectorAll<HTMLIFrameElement>(STREAM_IFRAME).forEach((frame) => {
    const wrapper = frame.parentElement;
    if (!wrapper || wrapper.dataset.streamState) return;

    wrapper.dataset.streamState = "loading";
    frame.addEventListener(
      "load",
      () => {
        wrapper.dataset.streamState = "loaded";
      },
      { once: true },
    );
  });
}

let scheduled = false;

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    markPendingEmbeds();
  });
}

let observer: MutationObserver | undefined;

export function onRouteDidUpdate(): void {
  schedule();

  // <Stream> resolves its src in an effect, so the iframe lands after the route settles.
  // Watching beats guessing a delay, and it covers client-side navigation for free.
  if (observer) return;
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
}
