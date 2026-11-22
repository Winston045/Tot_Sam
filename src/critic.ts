/**
 * Второй заход Gemini - редактор цитаты.
 *
 * Первый запрос делает всё сразу (оценка, теги, подпись), но справки о
 * самом предмете в кадре у него нет - только метаданные и статья о
 * событии. Отсюда штабные сводки вместо изюминок (аэростат у Ипра,
 * 10.2026: цели наступления на Пашендаль). Этот проход получает ещё и
 * справку о предмете (subject_wiki) и:
 * - слабую цитату (сводка, пересказ, опись, протокол, прописная истина)
 *   переписывает в научпоп о том, что в кадре, или сводит к «место, год»;
 * - обычный пост поднимает до изюминки, если справка даёт сильный факт.
 * Ничего не выдумывает: факты только из метаданных и справок.
 */
import type { AppConfig } from "./config.js";
import type { GeneratedCaption } from "./caption.js";
import { descriptiveSentences, isBarePlaceDate, metadataBlock } from "./caption.js";
import { unsupportedNumbers, validateYears } from "./validate.js";

export { isBarePlaceDate };
import type { RawItem } from "./sources/types.js";
import { GeminiBusyError, geminiJson } from "./gemini.js";

type Verdict = {
  verdict: "ok" | "weak";
  quote?: string;
  quote_kind?: "observation" | "context";
  /** новый текст поста - только ради правила ЛЮДИ */
  caption?: string;
};

export function buildPrompt(
  item: RawItem,
  generated: GeneratedCaption,
  extraContext?: string,
  subjectContext?: string,
  _people?: string[],
): string {
  const subject = subjectContext ? `\n${subjectContext}\n` : "\nСправки о технике в кадре нет.\n";
  return `Ты редактор телеграм-канала о военной технике. Твоя зона - цитата
под фотографией (блок отдельной строкой после подписи). Текст подписи не
трогай.

${metadataBlock(item, extraContext)}${subject}
Подпись: ${generated.caption}
Цитата: ${generated.quote || "(пусто)"}

Владелец канала (22.11): цитаты вида «на танке изображена лента» - глупые.
Цитата должна давать ПОЗНАВАТЕЛЬНОЕ, с жизнью:
- лор техники в кадре: откуда взялась эта машина или этот тип, чем
  необычна, где и как воевала, чем кончилась её история;
- или происходящее: где это, почему так, что за событие, чем кончилось.
Одно-три коротких предложения живым языком, без канцелярита.

Цитата ПЛОХАЯ, если это:
- опись видимого («на танке изображена...», «на заднем плане виден...»)
  без объяснения, чем это важно;
- перечень ТТХ (калибр, толщина брони, скорость) без истории;
- оценки без фактов («легендарный», «один из лучших», «грозная машина»);
- пересказ подписи;
- прописная истина («Вторая мировая шла с 1939 по 1945 год»).

Что делать:
1. Цитата уже познавательная и верная: ничего не меняй.
2. Цитата пустая или плохая: если в метаданных или справке есть
   познавательный факт о ЭТОЙ технике или ЭТОМ событии - напиши из него
   цитату; если нет - верни пустую цитату (пост выйдет без неё, это лучше
   глупой заметки).

Жёсткие правила:
- факты СТРОГО из метаданных и справки выше; не досочинять даже то, что
  «все знают»;
- справка идёт в дело, только если она точно про технику на фото (тот же
  тип, та же модель); чужая статья - не источник;
- не повторять подпись и дату; не писать место и год отдельной фразой;
- простой текст без HTML и markdown, кавычки - «ёлочки».

Верни строго JSON без обёрток, ровно одну из двух форм:
- цитату не менять: {"verdict": "ok"}
- новая цитата: {"verdict": "weak", "quote": "<новая цитата или пустая строка>", "quote_kind": "context"}`;
}

/**
 * Принимать ли новый текст поста от редактора. Ему разрешено только
 * пояснить, кто назван, или заменить имя ролью, - поэтому новый текст
 * обязан остаться одним предложением, а его годы и числа должны найтись
 * в источниках или в прежнем тексте. Иначе остаётся старый текст.
 */
export function acceptBody(
  proposed: string | undefined,
  current: string,
  item: RawItem,
  context: Array<string | undefined>,
): string | undefined {
  const body = plainDashes(proposed?.trim() ?? "");
  if (!body || body === current.trim()) return undefined;
  if (body.length > 300 || /<[^>]+>/.test(body)) return undefined;
  if (descriptiveSentences(body) > 1) return undefined;
  const sources = [item.title, item.description, item.place, current, ...context].filter(Boolean).join("\n");
  if (unsupportedNumbers(body, sources).length) return undefined;
  const years = validateYears(body, {
    title: item.title,
    description: item.description,
    year: item.year,
    place: item.place,
    context: [current, ...context].filter(Boolean).join("\n"),
  });
  return years.ok ? body : undefined;
}

/** Длинные тире - в обычный дефис, как во всём, что уходит в канал. */
function plainDashes(text: string): string {
  return text.replace(/[\u2012\u2013\u2014\u2015\u2212]/g, "-");
}

/**
 * Дублирует ли новая цитата отдельную строку места и даты. Сравнение по
 * буквам и цифрам без пунктуации: «Тихий океан, 1945 год.» == «Тихий океан 1945 год».
 */
export function duplicatesPlace(quote: string, place: string | undefined): boolean {
  if (!place) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const q = norm(quote);
  const p = norm(place);
  if (!q || !p) return false;
  return q.includes(p) || p.includes(q);
}

/**
 * Возвращает подпись с проверенной цитатой. Ошибка редактора (квота, сбой
 * разбора) не должна ронять сбор - тогда остаётся исходный вариант.
 */
export async function reviewQuote(
  item: RawItem,
  cfg: AppConfig,
  generated: GeneratedCaption,
  extraContext?: string,
  subjectContext?: string,
  /**
   * Пробросить «все модели перегружены» наверх, а не молча оставить
   * цитату первого захода. Сбор 22.10: редактор дважды пропущен с
   * ожиданием 196-240 с, и изюминки облегчённой модели ушли в резерв
   * без вычитки, хотя времени дождаться было больше десяти минут.
   */
  opts: {
    throwBusy?: boolean;
    /** люди, названные в тексте поста: с ними редактор смотрит и обычный пост */
    people?: string[];
  } = {},
): Promise<{ caption: GeneratedCaption; rewritten: boolean }> {
  // пустую цитату и штатное «место, год» без справки о предмете не
  // проверяем - экономим квоту: сделать из них изюминку не из чего.
  // Справка о предмете в кадре - ровно тот материал, которого не было у
  // первого захода, поэтому с ней редактор смотрит и обычный пост
  const plain = !generated.quote || isBarePlaceDate(generated.quote);
  const people = opts.people?.filter((p) => p.trim()) ?? [];
  if (plain && !subjectContext && !people.length) {
    return { caption: generated, rewritten: false };
  }
  try {
    const res = await geminiJson<Verdict>(
      [{ text: buildPrompt(item, generated, extraContext, subjectContext, people) }],
      { fullOnly: true },
    );
    // правка текста поста по правилу ЛЮДИ - со своими страховками
    const body = acceptBody(res.caption, generated.caption, item, [extraContext, subjectContext]);
    const bodyChanged = body !== undefined;
    if (body !== undefined) {
      console.log(`  текст поста поправлен (люди): «${generated.caption}» → «${body}»`);
      generated = { ...generated, caption: body };
    }
    if (res.verdict !== "weak") {
      return { caption: generated, rewritten: bodyChanged };
    }
    const quote = res.quote?.trim() ?? "";
    if (!quote) {
      // сильной замены не нашлось - цитата убирается, пост выходит коротким
      return { caption: { ...generated, quote: "" }, rewritten: true };
    }
    // замена - голые место и год, значит пост становится ОБЫЧНЫМ, и
    // цитата места должна остаться ОДНА. Если у изюминки уже стояла своя
    // строка места (quote_place), она точнее короткой замены («Район
    // Скарперии, Италия. 25 декабря 1944 года» против «Италия, 1944
    // год») и побеждает. Живой случай 07.09, карточка #308: буквальное
    // сравнение duplicatesPlace дубля не увидело, и в карточку уехали
    // ДВЕ цитаты места подряд
    if (isBarePlaceDate(quote)) {
      // канал @War_ThunDep: дата уже стоит курсивом в подписи, строка
      // «место, год» цитатой - дубль. Такую замену не берём
      return { caption: { ...generated, quote: "" }, rewritten: !!generated.quote };
    }
    // обычный пост стал изюминкой: его «место и год» уходят второй
    // цитатой после факта - канон изюминки (quote_place)
    const placeAfter =
      generated.quote_place ?? (plain && generated.quote ? generated.quote : undefined);
    return {
      caption: {
        ...generated,
        quote,
        // если модель всё же переписала цитату в место и дату, которые уже
        // стоят отдельной строкой, - вторую строку убираем, дубль хуже
        quote_place: duplicatesPlace(quote, placeAfter) ? undefined : placeAfter,
        quote_kind: res.quote_kind === "observation" ? "observation" : "context",
      },
      rewritten: true,
    };
  } catch (err) {
    if (opts.throwBusy && err instanceof GeminiBusyError) throw err;
    console.warn(`  редактор цитаты пропущен: ${(err as Error).message}`);
    return { caption: generated, rewritten: false };
  }
}
