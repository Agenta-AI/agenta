// The browser controller's pure parts: egress guard, outline, find blocks, change report, target resolution.
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const controller = require("../../src/browser/sandbox/controller.cjs") as {
  consequenceOf: (text: string) => "pay" | "delete" | null;
  documentAllowed: (url: string) => boolean;
  ipBlocked: (ip: string) => boolean;
  loginsChanged: (expected: unknown, loaded: unknown) => boolean;
  outline: (lines: string[], total: number, partChars?: number) => string;
  enclosingItem: (lines: string[], i: number) => number;
  itemBlock: (lines: string[], start: number) => string;
  lineChanges: (
    before: string[],
    after: string[],
  ) => { lines: string[]; gone: number };
  resolveTarget: (
    page: unknown,
    args: Record<string, string>,
  ) => Promise<unknown>;
};

const issue = (n: number, title = `Issue ${n}`) => [
  `    - listitem [ref=i${n}]:`,
  `      - link "${title}" [ref=l${n}] [cursor=pointer]`,
  `      - text: "#${7000 + n} · opened Oct 6"`,
];

describe("ipBlocked", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.17.0.2",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1%eth0",
    "ff02::1",
    "64:ff9b::808:808",
    "2001:db8::1",
  ])("blocks %s", (ip) => assert.equal(controller.ipBlocked(ip), true));

  it.each([
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:ac11:2",
  ])("blocks the IPv4-mapped address %s, in dotted or hex form", (ip) =>
    assert.equal(controller.ipBlocked(ip), true),
  );

  it.each([
    "8.8.8.8",
    "140.82.112.3",
    "2606:4700:4700::1111",
    "::ffff:808:808",
  ])("allows the public address %s", (ip) =>
    assert.equal(controller.ipBlocked(ip), false),
  );
});

describe("outline", () => {
  const page = [
    "- banner [ref=e1]:",
    ...Array.from({ length: 30 }, (_, k) => `  - link "nav ${k}" [ref=n${k}]`),
    "- main [ref=e2]:",
    '  - heading "Issues" [ref=e3]',
    '  - list "Issues" [ref=e4]:',
    ...Array.from({ length: 25 }, (_, k) =>
      issue(k, `Issue ${k} ${"x".repeat(1400)}`),
    ).flat(),
    '- complementary "Filters" [ref=e5]:',
    ...Array.from(
      { length: 200 },
      (_, k) => `  - checkbox "label ${k} ${"y".repeat(100)}" [ref=c${k}]`,
    ),
  ];
  const total = page.join("\n").length;

  it("lists the page's parts with their refs and sizes, and keeps a list whole", () => {
    const text = controller.outline(page, total);
    assert.match(text, /^\[Outline of a long page/);
    assert.match(text, /- list "Issues" \[ref=e4\] \([\d,]+ chars, 25 items\)/);
    assert.match(text, /- complementary "Filters" \[ref=e5\]/);
    assert.doesNotMatch(text, /listitem \[ref=i0\]/);
  });

  it("splits parts down to the requested size", () => {
    const coarse = controller.outline(page, total).split("\n").length;
    const fine = controller.outline(page, total, 2_000).split("\n").length;
    assert.ok(fine >= coarse);
  });

  it("names every item of a long list, whole items first and then one line each", () => {
    const list = page.slice(
      page.indexOf('  - list "Issues" [ref=e4]:'),
      page.indexOf('- complementary "Filters" [ref=e5]:'),
    );
    const text = controller.outline(
      list.map((line) => line.slice(2)),
      40_000,
    );
    assert.match(text, /more items, one line each/);
    for (let n = 0; n < 25; n++)
      assert.ok(text.includes(`#${7000 + n}`), `#${7000 + n} missing`);
    assert.ok(text.length <= 30_000 + 300);
  });
});

describe("find blocks", () => {
  const lines = [
    "- main [ref=e1]:",
    "  - list [ref=e2]:",
    ...issue(1, "Fix card"),
    ...issue(2, "Autofocus inputs"),
    '  - button "New issue" [ref=e9]',
  ];

  it("returns the whole list item around a match on any of its lines", () => {
    const fromTitle = controller.itemBlock(
      lines,
      controller.enclosingItem(lines, 3),
    );
    const fromNumber = controller.itemBlock(
      lines,
      controller.enclosingItem(lines, 4),
    );
    assert.equal(fromTitle, fromNumber);
    assert.match(fromTitle, /^- listitem \[ref=i1\]:/);
    assert.match(fromTitle, /Fix card/);
    assert.match(fromTitle, /#7001/);
    assert.doesNotMatch(fromTitle, /#7002/);
  });

  it("returns the line itself when it sits in no item", () => {
    assert.equal(
      controller.itemBlock(lines, controller.enclosingItem(lines, 8)),
      '- button "New issue" [ref=e9]',
    );
  });
});

describe("lineChanges", () => {
  const before = [
    "- main [ref=e1]:",
    '  - searchbox "Search" [ref=e2]',
    '  - button "Go" [ref=e3]',
  ];

  it("returns only the new lines, under the unchanged line they sit in", () => {
    const after = [
      ...before,
      "  - listbox [ref=e4]:",
      '    - option "Suggestion A" [ref=e5]',
    ];
    assert.deepEqual(controller.lineChanges(before, after), {
      lines: [
        "under: - main [ref=e1]:",
        "  - listbox [ref=e4]:",
        '    - option "Suggestion A" [ref=e5]',
      ],
      gone: 0,
    });
  });

  it("counts lines that left and reports nothing new when nothing appeared", () => {
    assert.deepEqual(controller.lineChanges(before, before.slice(0, 2)), {
      lines: [],
      gone: 1,
    });
  });

  it("treats repeated identical lines as separate lines", () => {
    const twice = ["- list [ref=e1]:", '  - text: "same"', '  - text: "same"'];
    assert.deepEqual(controller.lineChanges(twice.slice(0, 2), twice), {
      lines: ["under: - list [ref=e1]:", '  - text: "same"'],
      gone: 0,
    });
  });
});

describe("resolveTarget", () => {
  const snapshot = [
    "- main [ref=e1]:",
    '  - link "Issues (278)" [ref=e2] [cursor=pointer]',
    '  - link "Issues" [ref=e3] [cursor=pointer]',
    '  - button "Sign in" [ref=e4] [cursor=pointer]',
  ].join("\n");

  const fakePage = (counts: Record<string, number>) => {
    const pinned: string[] = [];
    return {
      pinned,
      ariaSnapshot: async () => snapshot,
      locator: (selector: string) => ({ selector, count: async () => 1 }),
      getByRole: (role: string, options: { name?: string } = {}) => ({
        count: async () => counts[`${role}:${options.name ?? ""}`] ?? 0,
        evaluate: async (_fn: unknown, id: string) => void pinned.push(id),
      }),
    };
  };

  it("acts on a single match and pins that element", async () => {
    const page = fakePage({ "button:Sign in": 1 });
    const target = (await controller.resolveTarget(page, {
      role: "button",
      name: "Sign in",
    })) as {
      selector: string;
    };
    assert.equal(page.pinned.length, 1);
    assert.equal(target.selector, `[data-agenta-target="${page.pinned[0]}"]`);
  });

  it("acts on nothing when several match, and lists them", async () => {
    const page = fakePage({ "link:Issues": 2 });
    await assert.rejects(
      controller.resolveTarget(page, { role: "link", name: "Issues" }),
      (e: Error & { code: string }) => {
        assert.equal(e.code, "ambiguous_target");
        assert.match(e.message, /Issues \(278\)/);
        assert.match(e.message, /link "Issues" \[ref=e3\]/);
        return true;
      },
    );
    assert.equal(page.pinned.length, 0);
  });

  it("acts on nothing when none match, and lists every element of that role", async () => {
    const page = fakePage({});
    await assert.rejects(
      controller.resolveTarget(page, { role: "button", name: "Nope" }),
      (e: Error & { code: string }) => {
        assert.equal(e.code, "element_not_found");
        assert.match(e.message, /button "Sign in"/);
        return true;
      },
    );
  });

  it("asks for a ref or a role when it has neither", async () => {
    await assert.rejects(
      controller.resolveTarget(fakePage({}), {}),
      (e: Error & { code: string }) => {
        assert.equal(e.code, "invalid_arguments");
        return true;
      },
    );
  });
});

describe("loginsChanged", () => {
  const loaded = { "prof-1": 3, "prof-2": 1 };

  it("accepts the same logins at the same sign-ins in any order", () => {
    assert.equal(
      controller.loginsChanged({ "prof-2": 1, "prof-1": 3 }, loaded),
      false,
    );
  });

  it("refuses a narrower or a different set", () => {
    assert.equal(controller.loginsChanged({ "prof-1": 3 }, loaded), true);
    assert.equal(
      controller.loginsChanged({ "prof-1": 3, "prof-3": 1 }, loaded),
      true,
    );
  });

  it("refuses a login signed in again since the browser loaded it", () => {
    assert.equal(
      controller.loginsChanged({ "prof-1": 4, "prof-2": 1 }, loaded),
      true,
    );
  });

  it("does not check a login browser or a call that names no set", () => {
    assert.equal(controller.loginsChanged({ "prof-1": 3 }, 4), false);
    assert.equal(controller.loginsChanged(undefined, loaded), false);
  });
});

describe("consequenceOf", () => {
  it.each([
    ["Delete this repository", "delete"],
    ["I want to delete this repository", "delete"],
    ["Remove member", "delete"],
    ["Place your order", "pay"],
    ["Buy now", "pay"],
    ["Pay $12.00", "pay"],
  ])("names %s as %s", (text, kind) => {
    assert.equal(controller.consequenceOf(text), kind);
  });

  it.each(["Sign in", "Issues", "Open pull request", "Display", "Payload"])(
    "leaves %s alone",
    (text) => {
      assert.equal(controller.consequenceOf(text), null);
    },
  );
});

describe("documentAllowed", () => {
  it("keeps blank and error pages, and refuses a site off the list", () => {
    assert.equal(controller.documentAllowed("about:blank"), true);
    assert.equal(
      controller.documentAllowed("chrome-error://chromewebdata/"),
      true,
    );
    assert.equal(controller.documentAllowed("https://evil.example/"), false);
    assert.equal(
      controller.documentAllowed("blob:https://evil.example/1"),
      false,
    );
    assert.equal(controller.documentAllowed("data:text/html,hi"), false);
  });
});
