"use strict";

// The live view: a person watches the active tab as a JPEG screencast over a WebSocket, sends
// mouse and keyboard input, takes control, and clicks "I'm done" to end the agent's `wait`.

const { within } = require("./browser.cjs");
const { LIVE_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS, VIEWPORT } = require("./config.cjs");
const { navigationAllowed, withScheme } = require("./ops.cjs");

const PLAYWRIGHT_PIN = "1.62.0 (services/runner/images/sandbox/install-agent-tools.sh)";

// Playwright has no public WebSocket server, and the sandbox has no `ws` package of its own.
// This bundled copy is a private path, so a Playwright upgrade must recheck it.
function webSocketServer(options) {
  let WebSocketServer;
  try {
    WebSocketServer = require("playwright-core/lib/utilsBundle").wsServer;
  } catch (e) {
    throw new Error(
      `The live view needs playwright-core's bundled WebSocket server (playwright-core/lib/utilsBundle), pinned to ${PLAYWRIGHT_PIN}: ${e.message}`,
    );
  }
  if (typeof WebSocketServer !== "function")
    throw new Error(
      `playwright-core/lib/utilsBundle has no wsServer; the live view is tested against Playwright ${PLAYWRIGHT_PIN}.`,
    );
  return new WebSocketServer(options);
}

const hostOf = (rawUrl) => {
  try {
    return new URL(rawUrl).hostname || rawUrl;
  } catch {
    return rawUrl;
  }
};

const MOUSE_BUTTONS = new Set(["left", "middle", "right"]);

const CONTROL_MESSAGES = new Set(["control", "done", "tab"]);
const PAGE_LOADS = new Set(["navigate", "reload"]);
const MODIFIERS = new Set(["Alt", "Control", "Meta"]);

const inputLimit = (message) =>
  PAGE_LOADS.has(message.type)
    ? NAVIGATION_TIMEOUT_MS
    : LIVE_TIMEOUT_MS + String(message.text ?? "").length * 20;

function createLiveView(session) {
  const viewers = new Set();
  const stuckPages = new WeakSet();
  const heldModifiers = new Set();
  let controller = null;
  let inputEpoch = 0;
  let screencast = null;
  let inputChain = Promise.resolve();

  function send(ws, message) {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  function broadcast(message) {
    const text = JSON.stringify(message);
    viewers.forEach((ws) => ws.readyState === 1 && ws.send(text));
  }

  async function statusMessage() {
    const tabs = await session.tabs();
    const active = tabs.find((tab) => tab.active);
    return {
      type: "status",
      control: session.control,
      wait_reason: session.waits.reason(),
      url: active?.url ?? "",
      title: active?.title ?? "",
      tabs,
    };
  }

  function broadcastStatus() {
    if (!viewers.size) return;
    statusMessage().then(broadcast).catch(() => {});
  }

  async function stopScreencast() {
    const current = screencast;
    screencast = null;
    if (!current) return;
    await within(current.session.send("Page.stopScreencast").catch(() => {}), LIVE_TIMEOUT_MS);
    await within(current.session.detach().catch(() => {}), LIVE_TIMEOUT_MS);
  }

  // Restarts run one after another: two overlapping ones would each attach a CDP session and
  // the first would keep streaming frames.
  let screencastChain = Promise.resolve();
  function restartScreencast() {
    const run = screencastChain.then(startScreencast);
    screencastChain = run.catch(() => {});
    return run;
  }

  async function startScreencast() {
    await stopScreencast();
    const page = session.activePage;
    if (!page || page.isClosed() || !viewers.size) return;
    const cdp = await session.context.newCDPSession(page);
    screencast = { session: cdp, page };
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      const text = JSON.stringify({
        type: "frame",
        data,
        width: metadata.deviceWidth,
        height: metadata.deviceHeight,
      });
      const open = [...viewers].filter((ws) => ws.readyState === 1);
      // Ack once every viewer has the frame, so Chrome sends no faster than the slowest viewer reads.
      Promise.all(open.map((ws) => new Promise((sent) => ws.send(text, sent))))
        .then(() => cdp.send("Page.screencastFrameAck", { sessionId }))
        .catch(() => {});
    });
    await within(
      cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        maxWidth: VIEWPORT.width,
        maxHeight: VIEWPORT.height,
      }),
      LIVE_TIMEOUT_MS,
    );
    // Chrome sends no screencast frame for a page that is not repainting, so a new viewer gets one explicitly.
    const still = await within(
      page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null),
      LIVE_TIMEOUT_MS,
      null,
    );
    if (still && screencast && screencast.page === page)
      broadcast({
        type: "frame",
        data: still.toString("base64"),
        width: VIEWPORT.width,
        height: VIEWPORT.height,
      });
  }

  session.on("status", broadcastStatus);
  session.on("page", () => {
    if (viewers.size) restartScreencast().catch(() => {});
  });

  // These must work while the page is frozen, so they never wait behind page input.
  async function applyControl(message) {
    session.noteInput();
    // Input already queued finishes on its own page, but must not take control back.
    if (message.type !== "control" || !message.take) inputEpoch++;
    if (message.type === "done") {
      session.setControl("agent");
      session.waits.done();
    } else if (message.type === "control") {
      session.setControl(message.take ? "user" : "agent");
    } else {
      // Only a person in control moves the browser: the agent acts on the active tab.
      const tab = session.pageById(Number(message.id));
      if (!tab || tab === session.activePage || session.control !== "user") return;
      await session.switchTo(tab);
    }
  }

  async function applyInput(message, page, takeControl) {
    session.noteInput();
    if (page.isClosed()) return;
    switch (message.type) {
      case "mouse": {
        takeControl();
        const x = Number(message.x) || 0;
        const y = Number(message.y) || 0;
        const button = MOUSE_BUTTONS.has(message.button) ? message.button : "left";
        await page.mouse.move(x, y);
        if (message.event === "down") await page.mouse.down({ button });
        else if (message.event === "up") await page.mouse.up({ button });
        else if (message.event === "wheel")
          await page.mouse.wheel(Number(message.deltaX) || 0, Number(message.deltaY) || 0);
        return;
      }
      case "key":
        takeControl();
        if (message.event === "down") {
          if (MODIFIERS.has(message.key)) heldModifiers.add(message.key);
          await page.keyboard.down(String(message.key));
        } else if (message.event === "up") {
          heldModifiers.delete(message.key);
          await page.keyboard.up(String(message.key));
        }
        return;
      case "text":
        takeControl();
        // A paste arrives with its Ctrl or Cmd still held, which would turn the text into shortcuts.
        for (const key of heldModifiers) await page.keyboard.up(key);
        heldModifiers.clear();
        // Real key presses, not bare inserted text: some forms (x.com) validate only on key events.
        await page.keyboard.type(String(message.text || ""));
        return;
      case "reload":
        takeControl();
        await page
          .reload({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS })
          .catch(() => broadcast({ type: "notice", message: "The page did not reload." }));
        return;
      case "navigate": {
        takeControl();
        const target = withScheme(message.url);
        // The viewer typed this address: say why it did not open, so the bar is never left lying.
        if (!navigationAllowed(target)) {
          broadcast({ type: "notice", message: `${hostOf(target)} cannot be opened.` });
          return;
        }
        await page
          .goto(target, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS })
          .catch(() => broadcast({ type: "notice", message: `${hostOf(target)} did not load.` }));
        return;
      }
    }
  }

  // A frozen page takes input for as long as it stays frozen; the queue must not wait on it.
  async function applyToLivePage(message, page, epoch) {
    if (!page) return;
    // The address bar can still rescue a frozen tab; a held button must still come up.
    if (stuckPages.has(page) && !PAGE_LOADS.has(message.type) && message.event !== "up") return;
    const takeControl = () => epoch === inputEpoch && session.setControl("user");
    const late = {};
    const work = applyInput(message, page, takeControl).finally(() => stuckPages.delete(page));
    if ((await within(work, inputLimit(message), late)) === late) stuckPages.add(page);
  }

  function attachViewer(ws) {
    viewers.add(ws);
    session.lastActivity = Date.now();
    statusMessage().then((m) => send(ws, m)).catch(() => {});
    // Every new viewer needs a first frame: Chrome sends none for a page that is not repainting.
    restartScreencast().catch(() => {});
    ws.on("message", (raw) => {
      session.lastActivity = Date.now();
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.type !== "done" && !(message.type === "control" && !message.take)) controller = ws;
      if (CONTROL_MESSAGES.has(message.type)) return void applyControl(message).catch(() => {});
      // One at a time, in arrival order: overlapping key presses would scramble typed text.
      const page = session.activePage;
      const epoch = inputEpoch;
      inputChain = inputChain.then(() => applyToLivePage(message, page, epoch)).catch(() => {});
    });
    // Closing the view hands control back but does not end a wait: only "I'm done" does.
    ws.on("close", () => {
      viewers.delete(ws);
      session.lastActivity = Date.now();
      if (ws === controller || !viewers.size) session.setControl("agent");
      if (!viewers.size) {
        screencastChain = screencastChain.then(stopScreencast).catch(() => {});
      }
    });
  }

  return {
    attachViewer,
    viewerCount: () => viewers.size,
  };
}

module.exports = { createLiveView, webSocketServer };
