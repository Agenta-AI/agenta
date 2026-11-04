"use strict";

// The live view: a person watches the active tab as a JPEG screencast over a WebSocket, sends
// mouse and keyboard input, takes control, and clicks "I'm done" to end the agent's `wait`.

const { NAVIGATION_TIMEOUT_MS, VIEWPORT } = require("./config.cjs");
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

function createLiveView(session) {
  const viewers = new Set();
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
    const page = session.activePage && !session.activePage.isClosed() ? session.activePage : null;
    return {
      type: "status",
      control: session.control,
      waiting: session.waits.reason(),
      url: page ? page.url() : "",
      title: page ? await page.title().catch(() => "") : "",
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
    await current.session.send("Page.stopScreencast").catch(() => {});
    await current.session.detach().catch(() => {});
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
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
    });
    // Chrome sends no screencast frame for a page that is not repainting, so a new viewer gets one explicitly.
    const still = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
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

  async function applyInput(message) {
    session.noteInput();
    if (message.type === "done") {
      session.setControl("agent");
      session.waits.done();
      return;
    }
    if (message.type === "control") {
      session.setControl(message.take ? "user" : "agent");
      return;
    }
    const page = session.activePage;
    if (!page || page.isClosed()) return;
    switch (message.type) {
      case "mouse": {
        session.setControl("user");
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
        session.setControl("user");
        if (message.event === "down") await page.keyboard.down(String(message.key));
        else if (message.event === "up") await page.keyboard.up(String(message.key));
        return;
      case "text":
        session.setControl("user");
        // Real key presses, not bare inserted text: some forms (x.com) validate only on key events.
        await page.keyboard.type(String(message.text || ""));
        return;
      case "reload":
        session.setControl("user");
        await page.reload({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
        return;
      case "navigate": {
        session.setControl("user");
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
      // One at a time, in arrival order: overlapping key presses would scramble typed text.
      inputChain = inputChain.then(() => applyInput(message)).catch(() => {});
    });
    // Closing the view hands control back but does not end a wait: only "I'm done" does.
    ws.on("close", () => {
      viewers.delete(ws);
      session.lastActivity = Date.now();
      if (!viewers.size) {
        session.setControl("agent");
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
