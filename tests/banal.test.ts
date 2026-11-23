import { describe, expect, it } from "vitest";
import { banalIn, guardBanal, stripBanal } from "../src/factcheck.js";

const cap = (quote: string) => ({ caption: "**Т-34-85** на марше.", quote, quote_kind: "context" as const });

describe("общеизвестное о технике (23.11)", () => {
  it("ловит школьные факты и штампы", () => {
    expect(banalIn("Т-34 стал самым массовым танком Второй мировой.")).toBeTruthy();
    expect(banalIn("Легендарная «тридцатьчетвёрка» прошла всю войну.")).toBeTruthy();
    expect(banalIn("Ил-2 называли «летающим танком».")).toBeTruthy();
    expect(banalIn("«Тигр» наводил ужас на противника.")).toBeTruthy();
    expect(banalIn("Войска перешли к обороне у Выборга.")).toBeTruthy();
  });

  it("не трогает конкретную деталь", () => {
    expect(banalIn("Башню Т-34-85 отливали на трёх заводах, и литьё заметно отличалось по форме.")).toBeUndefined();
  });

  it("вырезает банальное предложение и оставляет деталь", () => {
    const q = "Т-34 - самый массовый танк войны. Первые серийные машины Сталинградского завода шли без радиостанций и с упрощённой коробкой передач.";
    expect(stripBanal(q)).toMatch(/^Первые серийные/);
  });

  it("цитата из одного общеизвестного снимается целиком", () => {
    const v = guardBanal({ caption: cap("Легендарный танк."), rewritten: true }, cap(""));
    expect(v.caption.quote).toBe("");
    expect(v.outcome).toBe("quote_dropped");
  });
});

describe("предложения и сокращения (23.11)", async () => {
  const { splitSentences } = await import("../src/factcheck.js");
  it("«Pz. Kpfw. IV» - одно предложение", () => {
    const q = "Pz. Kpfw. IV стал самым массовым танком в истории немецкого танкостроения. С 1937 по 1945 год выпустили почти 8600 машин нескольких модификаций.";
    expect(splitSentences(q).length).toBe(2);
    expect(stripBanal(q)).toBe("С 1937 по 1945 год выпустили почти 8600 машин нескольких модификаций.");
  });
});
