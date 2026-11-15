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
