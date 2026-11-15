import { describe, expect, it } from "vitest";
import { hasTechRu } from "../src/sources/tech.js";
import { passesGate } from "../src/scoring.js";

describe("только техника (канал @War_ThunDep)", () => {
  it("подписи с техникой проходят", () => {
    for (const t of [
      "Немцы едут на захваченном советском танке КВ-1.",
      "Немецкое 75-мм горное орудие Geb.G.36 на Кавказе.",
      "Обер-лейтенант Георг Шентке со своим самолетом Bf109G на аэродроме Питомник.",
      "Т-35 и танкетки Т-27 на параде.",
      "Советские САУ на марше.",
      "Неудачная посадка пикирующего бомбардировщика SBD на палубу авианосца «Энтерпрайз».",
      "Вертолёт Ми-8 над аэродромом.",
    ]) expect(hasTechRu(t), t).toBe(true);
  });

  it("подписи без техники отсекаются", () => {
    for (const t of [
      "Немцы обыскивают дома в украинском селе.",
      "Проводы советских новобранцев, Южная Украина, лето 1941 года",
      "Никита Сергеевич Хрущев с офицерами в Сталинграде.",
      "Парад физкультурников",
      "Пленный немецкий солдат у Рейхстага.",
    ]) expect(hasTechRu(t), t).toBe(false);
  });

  it("кадр без техники не проходит ни с какой оценкой", () => {
    const v = passesGate({ score: 95, tags: { hook: "moment", tech: false } }, { minScore: 40, hooklessMinScore: 85 });
    expect(v).toEqual({ pass: false, reason: "notech" });
    expect(
      passesGate({ score: 60, tags: { hook: "vehicle", tech: true } }, { minScore: 40, hooklessMinScore: 85 }).pass,
    ).toBe(true);
  });
});

describe("любая техника, советское впереди (канал @War_ThunDep)", async () => {
  const { rank } = await import("../supabase/functions/_shared/plan.js");
  it("танк и самолёт при равной оценке равны", () => {
    const tank = { id: 1, score: 70, tags: { subject: "armor", period: "WW2" }, caption_html: "" };
    const plane = { id: 2, score: 70, tags: { subject: "aviation", period: "WW2" }, caption_html: "" };
    expect(rank(tank as never)).toBe(rank(plane as never));
  });
  it("советский танк холодной войны впереди современного", () => {
    const soviet = { id: 1, score: 65, tags: { subject: "armor", period: "cold_war" }, attribution: "РИА Новости", caption_html: "" };
    const modern = { id: 2, score: 75, tags: { subject: "armor", period: "modern" }, attribution: "Армия-2015", caption_html: "" };
    expect(rank(soviet as never)).toBeGreaterThan(rank(modern as never));
  });
});

describe("звёздочки в подписях", async () => {
  const { fixStars } = await import("../scripts/fix-stars.js");
  const { assembleCaptionHtml } = await import("../src/caption.js");
  it("старая подпись: пара звёздочек - жирный, одиночные убираются", () => {
    expect(fixStars("<blockquote>На башне **Pz.Kpfw. III** и *пыль*.</blockquote>")).toBe(
      "<blockquote>На башне <b>Pz.Kpfw. III</b> и пыль.</blockquote>",
    );
  });
  it("новая подпись: ни одной звёздочки ни в теле, ни в цитате", () => {
    const html = assembleCaptionHtml(
      { caption: "**Танки Pz.Kpfw. III** на исходных позициях.", date: "1941 год", quote: "На переднем плане - танкисты на башне **Pz.Kpfw. III**, *пыль*.", quote_kind: "observation" },
      { license: "PD" },
      { id: "", signature: "", signature_url: "" },
    );
    expect(html).not.toContain("*");
    expect(html).toContain("<b>Pz.Kpfw. III</b>");
  });
});
