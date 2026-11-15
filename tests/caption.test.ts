import { describe, expect, it } from "vitest";
import { assembleCaptionHtml, needsAttribution } from "../src/caption.js";
import { buildAnalysisPrompt } from "../src/analyze.js";
import { validateCaption } from "../src/validate.js";
import { splitFooter } from "../supabase/functions/_shared/edit_caption.js";

const channel = {
  id: "@Story_Teams",
  signature: "STORY | TEAM",
  signature_url: "https://t.me/Story_Teams",
};

const generated = {
  caption: "<b>Танкисты</b> у танка Т-34-85. <i>1945 год.</i>",
  quote: "Надпись на стволе пушки — «Победа за нами».",
  quote_kind: "observation" as const,
};

describe("needsAttribution", () => {
  it("PD — нет, CC-BY-SA — да", () => {
    expect(needsAttribution("PD")).toBe(false);
    expect(needsAttribution("CC BY-SA 3.0 de")).toBe(true);
    expect(needsAttribution("CC-BY-SA-4.0")).toBe(true);
  });
});

describe("assembleCaptionHtml", () => {




  it("без цитаты blockquote не появляется", () => {
    const html = assembleCaptionHtml(
      { ...generated, quote: "" },
      { license: "PD" },
      channel,
    );
    expect(html).not.toContain("blockquote");
  });

  it("итог проходит валидацию подписи", () => {
    const html = assembleCaptionHtml(generated, { license: "PD" }, channel);
    expect(
      validateCaption(html, { title: "T-34-85, 1945", description: undefined, year: 1945, place: "Berlin" }),
    ).toEqual({ ok: true });
  });
});

describe("buildAnalysisPrompt", () => {

  it("требует обоснование балла и запрещает завышать оценку рутине", () => {
    const prompt = buildAnalysisPrompt(
      { sourceId: "1", sourceUrl: "https://x", imageUrl: "https://x.jpg", lang: "en", license: "PD" },
      {},
    );
    expect(prompt).toContain("score_why");
    expect(prompt).toContain("Средний архивный кадр это 45-55");
    expect(prompt).toContain("учения и подготовка в тылу");
  });

  it("описывает крючки поста примерами из ручной редактуры канала", () => {
    const prompt = buildAnalysisPrompt(
      { sourceId: "1", sourceUrl: "https://x", imageUrl: "https://x.jpg", lang: "en", license: "PD" },
      {},
    );
    expect(prompt).toContain('"hook"');
    for (const hook of ["trophy", "wreck", "moment", "rare", "oddity", "human", "action", "none"]) {
      expect(prompt).toContain(hook);
    }
    // поза не мешает трофею: так отбирала живая редакция
    expect(prompt).toContain("Поза тут не мешает");
    // оценка отвечает только за качество снимка: команда «оценивай в
    // 25-40» кадры без крючка противоречила этому и дублировала гейт
    expect(prompt).not.toContain("оценивай в 25-40");
    expect(prompt).toContain("Оценку таким кадрам НЕ занижай");
  });

});

describe("placeToQuote (лекарь: дата из тела в цитату)", async () => {
  const { placeToQuote, isBarePlaceDate } = await import("../scripts/fix-place.js");

  it("отличает голые место и дату от справки", () => {
    expect(isBarePlaceDate("Италия, 1943 год.")).toBe(true);
    expect(isBarePlaceDate("Район Арраса, Франция. 19 июля 1918 года.")).toBe(true);
    expect(isBarePlaceDate("Трал ПТ-3 выдерживал от пяти до десяти детонаций.")).toBe(false);
    expect(
      isBarePlaceDate(
        "В 1943 году она участвовала в строительстве бензопровода, проложенного по дну Ладожского озера и ставшего для осажденного Ленинграда артерией жизни.",
      ),
    ).toBe(false);
  });

  it("дата из последней строки тела переезжает в цитату", () => {
    const broken =
      "Немецкие солдаты перед расстрелом группы советских партизан.\n" +
      "Север СССР, 1941 год.\n\n" +
      '<a href="https://t.me/Story_Teams">STORY | TEAM</a>';
    expect(placeToQuote(broken)).toBe(
      "Немецкие солдаты перед расстрелом группы советских партизан.\n" +
        "<blockquote expandable>Север СССР, 1941 год.</blockquote>\n\n" +
        '<a href="https://t.me/Story_Teams">STORY | TEAM</a>',
    );
  });

  it("изюминку с цитатой и датой в теле не трогает", () => {
    const gem =
      "Британский танк Sherman III в районе Бенгази.\n" +
      "Ливия, декабрь 1942 года.\n" +
      "<blockquote expandable>В 1942 году Бенгази стал ареной ожесточенных боев.</blockquote>\n\n" +
      '<a href="https://t.me/Story_Teams">STORY | TEAM</a>';
    expect(placeToQuote(gem)).toBeNull();
  });

  it("описание без даты в конце не трогает", () => {
    const plain =
      "Немецкие парашютисты люфтваффе во время перекура.\n" +
      "Они находятся в Италии уже второй месяц.\n\n" +
      '<a href="https://t.me/Story_Teams">STORY | TEAM</a>';
    expect(placeToQuote(plain)).toBeNull();
  });

  it("две цитаты места подряд схлопываются в одну точную", async () => {
    const { collapseDoublePlace } = await import("../scripts/fix-place.js");
    // карточка #308, 07.09: критик заменил слабую изюминку на «Италия,
    // 1944 год», а точный «Район Скарперии...» остался второй цитатой
    const broken =
      "Американский и британский связисты празднуют Рождество с местными итальянскими мальчиками у своей праздничной елки.\n" +
      "<blockquote expandable>Италия, 1944 год.</blockquote>\n" +
      "<blockquote>Район Скарперии, Италия. 25 декабря 1944 года.</blockquote>\n\n" +
      '<a href="https://t.me/Story_Teams">STORY | TEAM</a>';
    expect(collapseDoublePlace(broken)).toBe(
      "Американский и британский связисты празднуют Рождество с местными итальянскими мальчиками у своей праздничной елки.\n" +
        "<blockquote expandable>Район Скарперии, Италия. 25 декабря 1944 года.</blockquote>\n\n" +
        '<a href="https://t.me/Story_Teams">STORY | TEAM</a>',
    );
  });

  it("настоящую изюминку с цитатой места лекарь двойного места не трогает", async () => {
    const { collapseDoublePlace } = await import("../scripts/fix-place.js");
    const gem =
      "Японский крейсер «Яхаги» под ударами американской авиации.\n" +
      "<blockquote expandable>Крейсер перевернулся и затонул, унеся жизни 445 моряков.</blockquote>\n" +
      "<blockquote>Тихий океан, 1945 год.</blockquote>\n\n" +
      '<a href="https://t.me/Story_Teams">STORY | TEAM</a>';
    expect(collapseDoublePlace(gem)).toBeNull();
    // короткий ФАКТ с годом эвристика места не отличает - его спасает
    // правило «первая цитата короче второй»
    const shortFact =
      "Британский танк Sherman III в районе Бенгази.\n" +
      "<blockquote expandable>В 1942 году Бенгази стал ареной ожесточённых боёв.</blockquote>\n" +
      "<blockquote>Ливия, декабрь 1942 года.</blockquote>\n\n" +
      '<a href="https://t.me/Story_Teams">STORY | TEAM</a>';
    expect(collapseDoublePlace(shortFact)).toBeNull();
  });

  it("подпись без переносов не трогает", () => {
    expect(placeToQuote('Текст.\n\n<a href="x">X</a>')).toBeNull();
  });
});

describe("страховка формата обычного поста", () => {




  it("описание из двух предложений без даты не трогает", () => {
    const html = assembleCaptionHtml(
      {
        caption: "Немецкие парашютисты во время перекура.\nОни ждут погрузки в транспортник.",
        quote: "",
        quote_kind: "context",
      },
      { license: "PD" },
      channel,
    );
    expect(html).not.toContain("blockquote");
  });
});

describe("описание в одно предложение", async () => {
  const { descriptiveSentences } = await import("../src/caption.js");

  it("сегодняшние хорошие посты - ровно одно предложение", () => {
    expect(
      descriptiveSentences("Женщина с двумя дочерьми смотрит на руины своего сожжённого дома."),
    ).toBe(1);
    expect(
      descriptiveSentences("Тело генерала пехоты вермахта Антона Достлера у столба сразу после расстрела."),
    ).toBe(1);
  });

  it("строка места и года в теле изюминки за предложение не считается", () => {
    expect(
      descriptiveSentences(
        "Британский самолет-тральщик Vickers Wellington DWI Mark II на аэродроме в Исмаилии.\nЕгипет, 1940 год.",
      ),
    ).toBe(1);
    // эталон 6 из промпта: год стоит в той же строке, а не отдельной
    expect(
      descriptiveSentences(
        "Колонна немецких средних Pz.III J и Pz.III L из 12-й танковой дивизии вермахта зимой на Восточном фронте. 1942 г.",
      ),
    ).toBe(1);
  });

  it("вьетнамский пост ловится: справка уехала во второе предложение", () => {
    expect(
      descriptiveSentences(
        "Бойцы роты C 502-го пехотного полка 101-й воздушно-десантной дивизии США поднимаются по крутому склону в поисках сил Вьетконга. " +
          "Снимок сделан во время операции «Харрисон» в горном районе близ Туихоа.",
      ),
    ).toBe(2);
  });
});


describe("длинные тире не уходят в Телеграм", async () => {
  const { plainDashes } = await import("../src/telegram.js");

  it("меняет все виды длинного тире на дефис", () => {
    expect(plainDashes("Берлин — 1945")).toBe("Берлин - 1945");
    expect(plainDashes("1941–1945")).toBe("1941-1945");
    expect(plainDashes("шкала −5")).toBe("шкала -5");
    expect(plainDashes("текст ― вставка")).toBe("текст - вставка");
  });

  it("обычный дефис и минус в числах не трогает", () => {
    expect(plainDashes("Т-34-85, 8,8-см")).toBe("Т-34-85, 8,8-см");
  });

});

describe("формат канала @War_ThunDep", () => {
  const ch = { id: "@War_ThunDep", signature: "", signature_url: "" };
  const base = { caption: "", quote: "", quote_kind: "context" as const };

  it("техника жирным, дата курсивом, хэштеги, без подписи канала", () => {
    const html = assembleCaptionHtml(
      { ...base, caption: "**Танки КВ-1** на площади Урицкого (Дворцовая площадь).", date: "1942 год" },
      { license: "PD" },
      ch,
    );
    expect(html).toBe(
      "<b>Танки КВ-1</b> на площади Урицкого (Дворцовая площадь). <i>1942 год.</i>\n\n#photo #история",
    );
    expect(html).not.toContain("<a href");
  });

  it("цитата-деталь идёт строкой ниже, длинное тире сохраняется", () => {
    const html = assembleCaptionHtml(
      {
        ...base,
        caption: "**Танки Pz.Kpfw. V «Пантера»** в Нормандии",
        date: "1944 год.",
        quote: "На переднем плане — дульный тормоз орудия одной из «Пантер».",
        quote_kind: "observation",
      },
      { license: "PD" },
      ch,
    );
    expect(html).toBe(
      "<b>Танки Pz.Kpfw. V «Пантера»</b> в Нормандии. <i>1944 год.</i>\n" +
        "<blockquote>На переднем плане — дульный тормоз орудия одной из «Пантер».</blockquote>\n\n#photo #история",
    );
  });

  it("дата с заглавной буквы: «Лето 1941 года.»", () => {
    const html = assembleCaptionHtml({ ...base, caption: "Немецкие пехотинцы в деревне.", date: "лето 1941 года" }, { license: "PD" }, ch);
    expect(html).toContain("<i>Лето 1941 года.</i>");
  });

  it("без даты курсива нет, лишние звёздочки и HTML экранируются", () => {
    const html = assembleCaptionHtml(
      { ...base, caption: "Немцы у **Т-34 и* <script>." },
      { license: "PD" },
      ch,
    );
    expect(html).toBe("Немцы у Т-34 и &lt;script&gt;.\n\n#photo #история");
  });

  it("хэштеги - футер: правка тела и вычитка его не трогают", () => {
    const html = assembleCaptionHtml({ ...base, caption: "**Т-35** на параде.", date: "1937 год" }, { license: "PD" }, ch);
    const { body, footer } = splitFooter(html);
    expect(footer).toBe("#photo #история");
    expect(body).toBe("<b>Т-35</b> на параде. <i>1937 год.</i>");
  });

  it("промпт: тема канала, техника в звёздочках, без Первой мировой", () => {
    const prompt = buildAnalysisPrompt(
      { sourceId: "1", sourceUrl: "https://x", imageUrl: "https://x.jpg", lang: "en", license: "PD", title: "KV-1 tanks", year: 1942 },
      {},
    );
    expect(prompt).toContain("ВОЕННОЙ ТЕХНИКЕ");
    expect(prompt).toContain("**двойные");
    expect(prompt).toContain("Первая\n  мировая");
    expect(prompt).toContain('"vehicle"');
    expect(prompt).toContain('"date"');
  });
});
