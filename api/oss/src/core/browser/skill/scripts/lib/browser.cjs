"use strict";

// The one Chromium, its context and the tab the agent acts on. Emits "page" when the active tab
// changes and "status" when anything the live view shows changes.

const { EventEmitter } = require("node:events");
const { USER_IDLE_MS, VIEWPORT } = require("./config.cjs");
const { stateStore } = require("./state.cjs");

function createSession({ stateFile, waits }) {
  const session = new EventEmitter();
  Object.assign(session, {
    browser: null,
    context: null,
    activePage: null,
    control: "agent",
    store: stateStore(stateFile),
    waits,
    lastActivity: Date.now(),
    lastInput: 0,
  });

  session.connected = () => Boolean(session.browser?.isConnected());

  session.setActivePage = (page) => {
    session.activePage = page;
    session.emit("page", page);
    session.emit("status");
  };

  session.currentPage = async () => {
    if (!session.activePage || session.activePage.isClosed())
      session.setActivePage(await session.context.newPage());
    return session.activePage;
  };

  session.setControl = (next) => {
    if (next === "user") session.noteInput();
    if (session.control === next) return;
    session.control = next;
    session.emit("status");
  };

  session.noteInput = () => {
    session.lastInput = Date.now();
  };

  session.personActive = () =>
    session.control === "user" && Date.now() - session.lastInput < USER_IDLE_MS;

  session.saveState = async () =>
    session.store.save(await session.context.storageState());

  function trackPage(page) {
    page.on("close", () => {
      if (page !== session.activePage) return;
      const open = session.context.pages();
      session.setActivePage(open.length ? open[open.length - 1] : null);
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && page === session.activePage)
        session.emit("status");
    });
  }

  session.launch = async () => {
    const { chromium } = require("playwright-core");
    const browser = await chromium.launch({
      headless: true,
      // The full Chromium build, not the headless shell: sites such as x.com refuse the shell with 403.
      channel: "chromium",
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
    });
    session.browser = browser;
    browser.on("disconnected", () => session.emit("disconnected"));
    const saved = session.store.loaded();
    session.context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
      locale: "en-US",
      acceptDownloads: false,
      ...(saved ? { storageState: saved } : {}),
    });
    session.context.on("page", (page) => {
      trackPage(page);
      // A tab the person opened in the live view is the one they look at. A tab the agent's
      // command opened is reported in that command's output; the agent switches with `tab`.
      if (session.control === "user") session.setActivePage(page);
    });
    session.setActivePage(await session.context.newPage());
  };

  return session;
}

module.exports = { createSession };
