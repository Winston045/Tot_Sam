import { describe, expect, it } from "vitest";
import { quoteFromHtml, swapQuote } from "../src/taken.js";
import { buildPrompt } from "../src/critic.js";

const OLD = "<b>2С35 «Коалиция-СВ»</b> на параде Победы. <i>9 мая 2015 года.</i>\n<blockquote>Старая цитата.</blockquote>\n\n#photo #история";
const NEW = "<b>2С35</b> в Москве. <i>2015 год.</i>\n<blockquote>Новая цитата &amp; факт.</blockquote>\n\n#photo #история";

describe("перепись меняет только цитату (23.11)", () => {
  it("подпись и дата прежние, цитата новая", () => {
    const out = swapQuote(OLD, NEW);
    expect(out).toContain("на параде Победы. <i>9 мая 2015 года.</i>");
    expect(out).toContain("<blockquote>Новая цитата &amp; факт.</blockquote>");
    expect(out).not.toContain("Старая");
    expect(out.endsWith("\n\n#photo #история")).toBe(true);
  });
  it("новая без цитаты - цитата снимается; старая без цитаты - добавляется", () => {
    expect(swapQuote(OLD, "x\n\n#photo #история")).toBe("<b>2С35 «Коалиция-СВ»</b> на параде Победы. <i>9 мая 2015 года.</i>\n\n#photo #история");
    const bare = "<b>Т-34</b> под Харьковом.\n\n#photo #история";
    expect(swapQuote(bare, NEW)).toBe("<b>Т-34</b> под Харьковом.\n<blockquote>Новая цитата &amp; факт.</blockquote>\n\n#photo #история");
  });
  it("текст цитаты из html", () => {
    expect(quoteFromHtml(NEW)).toBe("Новая цитата & факт.");
    expect(quoteFromHtml("без цитаты")).toBe("");
  });
  it("редактор видит уже взятые факты о той же технике", () => {
    const p = buildPrompt(
      { sourceId: "1", sourceUrl: "https://x", imageUrl: "https://x.jpg", lang: "ru", license: "PD" },
      { caption: "**Т-34**.", quote: "", quote_kind: "context" },
      undefined,
      "Справка",
      [],
      ["Дизель В-2 дал высокую удельную мощность."],
    );
    expect(p).toContain("УЖЕ ЕСТЬ В КАНАЛЕ");
    expect(p).toContain("Дизель В-2");
  });
});
