import { describe, expect, test } from "bun:test";
import { chromium } from "playwright";
import {
  readAlongActiveRange,
  readAlongSegments,
} from "../src/client/readalong";
import type { WordTiming } from "../src/shared/contracts";

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

describe("read-along visual rendering", () => {
  test("highlights recent/current spans without highlighting future text", async () => {
    const text = "Alpha beta gamma future";
    const spans: Array<WordTiming> = [
      [0, 5, 0, 350],
      [6, 10, 350, 700],
      [11, 16, 700, 1050],
      [17, 23, 1050, 1400],
    ];
    const active = readAlongActiveRange(text, spans, 900);
    const html = readAlongSegments(text, spans)
      .map((segment) =>
        segment.index === undefined
          ? escapeHtml(segment.text)
          : `<span class="spoken-word ${
              segment.index >= active.start && segment.index <= active.end
                ? "now"
                : ""
            }">${escapeHtml(segment.text)}</span>`,
      )
      .join("");

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 500, height: 160 },
      });
      await page.setContent(`
        <style>
          body { font: 20px system-ui; padding: 24px; }
          .spoken-word { border-radius: 4px; padding: 1px 2px; }
          .spoken-word.now { background: rgb(236, 234, 250); color: rgb(93, 88, 198); }
        </style>
        <main class="msg-spoken">${html}</main>
      `);

      const activeSpan = page.locator(".spoken-word.now");
      expect(await activeSpan.allTextContents()).toEqual([
        "Alpha",
        "beta",
        "gamma",
      ]);
      expect(await page.locator(".spoken-word.now").count()).toBe(3);
      expect(await page.locator(".spoken-word").last().textContent()).toBe(
        "future",
      );
    } finally {
      await browser.close();
    }
  });
});
