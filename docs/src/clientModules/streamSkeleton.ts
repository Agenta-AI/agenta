/**
 * Cloudflare Stream paints nothing until its player boots, so the embed's box sits empty
 * on a slow connection. Mark each embed's wrapper while it loads; media.css draws the
 * skeleton off that attribute and drops it once the player has its first frame.
 *
 * Driven off the iframe rather than the <Stream> component so the raw <iframe> embeds in
 * the changelog get the same treatment. The iframe's own `load` event fires before the
 * player has any video, so the wrapper waits for the Stream SDK's `loadeddata` when the
 * SDK is available, and always resolves after a timeout so a slow or failed embed never
 * stays hidden.
 */
const STREAM_IFRAME = 'iframe[src*="cloudflarestream"]';
const SDK_SRC = "https://embed.cloudflarestream.com/embed/sdk.latest.js";
const MAX_WAIT_MS = 8000;

type StreamPlayer = {
  addEventListener: (event: string, handler: () => void) => void;
};

declare global {
  interface Window {
    Stream?: (iframe: HTMLIFrameElement) => StreamPlayer;
  }
}

let sdkPromise: Promise<void> | undefined;

function loadSdk(): Promise<void> {
  if (window.Stream) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = SDK_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

function watch(frame: HTMLIFrameElement, wrapper: HTMLElement): void {
  wrapper.dataset.streamState = "loading";

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    wrapper.dataset.streamState = "loaded";
  };

  // Never trap the embed behind the skeleton.
  window.setTimeout(finish, MAX_WAIT_MS);

  loadSdk().then(() => {
    if (done) return;
    if (!window.Stream) {
      // No SDK: the iframe's load event is the best signal there is.
      frame.addEventListener("load", finish, { once: true });
      return;
    }
    try {
      const player = window.Stream(frame);
      player.addEventListener("loadeddata", finish);
      player.addEventListener("canplay", finish);
      player.addEventListener("error", finish);
    } catch {
      finish();
    }
  });
}

function markPendingEmbeds(): void {
  document.querySelectorAll<HTMLIFrameElement>(STREAM_IFRAME).forEach((frame) => {
    const wrapper = frame.parentElement;
    if (!wrapper || wrapper.dataset.streamState) return;
    watch(frame, wrapper);
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
