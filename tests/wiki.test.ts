import { afterEach, describe, expect, it, vi } from "vitest";
import { subjectReference } from "../src/wiki.js";

const LONG_EN =
  "An observation balloon is a type of balloon that is employed as an aerial platform for intelligence " +
  "gathering and artillery spotting. Use of observation balloons began during the French Revolutionary Wars.";
const LONG_RU =
  "Привязной аэростат - аэростат, удерживаемый над землёй тросом; в Первую мировую войну такие аэростаты " +
  "служили наблюдательными пунктами для корректировки артиллерийского огня.";

function stub(pages: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      const lang = url.hostname.split(".")[0]!;
      const page = pages[`${lang}:${url.searchParams.get("titles")}`] ?? { missing: true };
      return new Response(JSON.stringify({ query: { pages: [page] } }));
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("справка о предмете в кадре", () => {
  it("берёт русскую статью по межъязыковой ссылке", async () => {
    stub({
      "en:Observation balloon": {
        title: "Observation balloon",
        extract: LONG_EN,
        langlinks: [{ lang: "ru", title: "Привязной аэростат" }],
      },
      "ru:Привязной аэростат": { title: "Привязной аэростат", extract: LONG_RU },
    });
    const ref = await subjectReference("Observation balloon");
    expect(ref).toContain("«Привязной аэростат»");
    expect(ref).toContain("корректировки артиллерийского огня");
  });

  it("без русской статьи - английская", async () => {
    stub({ "en:Observation balloon": { title: "Observation balloon", extract: LONG_EN } });
    expect(await subjectReference("Observation balloon")).toContain("artillery spotting");
  });

  it("страница-развилка и пустое название справкой не считаются", async () => {
    stub({
      "en:Tiger": {
        title: "Tiger",
        extract: "Tiger may refer to: the animal; Tiger I, a German tank; Tiger II ... ".repeat(3),
      },
    });
    expect(await subjectReference("Tiger")).toBeUndefined();
    expect(await subjectReference("  ")).toBeUndefined();
  });

  it("сбой сети - просто без справки", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNRESET"))));
    expect(await subjectReference("Observation balloon")).toBeUndefined();
  });
});

describe("Википедия: вежливость к лимиту", () => {
  it("после 429 - пауза: следующие запросы не уходят вовсе", async () => {
    const calls = vi.fn(async () => new Response("slow down", { status: 429 }));
    vi.stubGlobal("fetch", calls);
    expect(await subjectReference("Observation balloon")).toBeUndefined();
    const after = calls.mock.calls.length;
    expect(await subjectReference("Tiger I")).toBeUndefined();
    // в паузе Википедию не дёргаем - лимит не продлеваем
    expect(calls.mock.calls.length).toBe(after);
  });
});

describe("справка о технике - разделы статьи (23.11)", async () => {
  const { techSections } = await import("../src/wiki.js");
  it("вступление и технические разделы, без примечаний и музеев", () => {
    const text = [
      "Т-34 - советский средний танк.",
      "\n== История создания ==\nПрототип А-32 испытывали летом 1939 года.",
      "\n== Конструкция ==\nЛюк механика-водителя был в лобовом листе.",
      "\n=== Двигатель ===\nВоздухоочиститель «Помон» поставили в 1942 году.",
      "\n== Сохранившиеся экземпляры ==\nТанк стоит в музее.",
      "\n=== В Европе ===\nЕщё один в Кубинке.",
      "\n== Боевое применение ==\nЭкипажи жаловались на тесную башню.",
      "\n== Примечания ==\n1. Источник.",
      "\n",
    ].join("");
    const out = techSections(text);
    expect(out).toContain("советский средний танк");
    expect(out).toContain("[Конструкция] Люк механика-водителя");
    expect(out).toContain("«Помон»");
    expect(out).toContain("тесную башню");
    expect(out).not.toContain("музее");
    expect(out).not.toContain("Кубинке");
    expect(out).not.toContain("Источник");
  });
});
