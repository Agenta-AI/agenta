"use strict";

// The one Chromium, its context and the tab the agent acts on. Emits "page" when the active tab
// changes and "status" when anything the live view shows changes.

const { EventEmitter } = require("node:events");
const { USER_IDLE_MS, VIEWPORT } = require("./config.cjs");
const { stateStore } = require("./state.cjs");

// A tab that hangs must not hold back the status of the others.
const TITLE_WAIT_MS = 1_000;

const titleOf = (page) =>
  Promise.race([
    page.title().catch(() => ""),
    new Promise((resolve) => setTimeout(resolve, TITLE_WAIT_MS, "")),
  ]);

function createSession({ stateFile, waits }) {
  const session = new EventEmitter();
  const tabIds = new WeakMap();
  let lastTabId = 0;
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

  session.switchTo = async (page) => {
    await page.bringToFront().catch(() => {});
    session.setActivePage(page);
  };

  session.openTab = async () => {
    const page = await session.context.newPage();
    await session.switchTo(page);
    return page;
  };

  // Ids stay with a tab while others open and close; a viewer's click must not land on a neighbour.
  session.pageById = (id) => session.context.pages().find((page) => tabIds.get(page) === id);

  session.tabs = () =>
    Promise.all(
      (session.context?.pages() ?? []).map(async (page) => ({
        id: tabIds.get(page),
        title: await titleOf(page),
        url: page.url(),
        active: page === session.activePage,
      })),
    );

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
    tabIds.set(page, ++lastTabId);
    page.on("close", () => {
      if (page !== session.activePage) return session.emit("status");
      const open = session.context.pages();
      session.setActivePage(open.length ? open[open.length - 1] : null);
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) session.emit("status");
    });
    // The title is not known yet when the frame navigates.
    page.on("domcontentloaded", () => session.emit("status"));
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
      else session.emit("status");
    });
    session.setActivePage(await session.context.newPage());
  };

  return session;
}

module.exports = { createSession, titleOf };
