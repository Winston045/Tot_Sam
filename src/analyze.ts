/**
 * Объединённый анализ снимка: оценка + теги + готовая подпись ОДНИМ
 * запросом к Gemini. Раньше на карточку уходило два запроса (скоринг,
 * потом подпись) — при дневной квоте бесплатного тарифа это роскошь.
 * Бонус: подпись есть у каждого оценённого фото, хорошие кандидаты
 * копятся в резерв, и /more может слать их вообще без Gemini.
 */
import type { AppConfig } from "./config.js";
import type { RawItem } from "./sources/types.js";
import { geminiJson, imagePart } from "./gemini.js";
import { FEW_SHOT, captionRules, metadataBlock } from "./caption.js";
import { SCORE_FIELDS_SCHEMA, SCORING_CRITERIA } from "./scoring.js";
import { normalizeStory, storyGuide } from "./story.js";
import type { GeneratedCaption } from "./caption.js";
import type { VisionScore } from "./scoring.js";
import { rubricOf } from "./rubrics.js";

export type Analysis = VisionScore &
  GeneratedCaption & {
    /**
     * Английское название статьи Википедии о главном предмете кадра
     * («Observation balloon», «HMS Campbeltown (I42)»). По нему сборщик
     * достаёт справку, и редактор цитат строит изюминку о самом предмете,
     * а не о событии вокруг.
     */
    subject_wiki?: string;
    /**
     * Люди, названные в тексте поста по имени. По нему редактор цитат
     * проверяет, объяснено ли читателю, кто это (правило 10 подписи).
     */
    people?: string[];
    /** Английское название статьи о знаковом событии, частью которого был кадр. */
    event_wiki?: string;
  };

/**
 * Война целиком, кампания и театр - не событие кадра: их справка - учебник,
 * из которого выходят прописные истины. Предпросмотр 08.11: по «Mesopotamian
 * campaign» редактор написал к кадру с пушкой обзор кампании («взяли
 * Багдад и заняли почти всю Месопотамию») - ход операций, а не ставки.
 */
export const GENERIC_EVENT =
  /^(world war (i|ii|one|two)|(first|second) world war|cold war|(eastern|western) front( \(world war (i|ii)\))?)$|\bcampaign\b|\bthea(tre|ter)\b|^(the )?[\w-]+( [\w-]+)? war$/i;

export function buildAnalysisPrompt(
  item: RawItem,
  glossary: Record<string, string>,
  extraContext?: string,
): string {
  // кадр рубрики судится по её правилам: без этого модель честно ставила
  // бы плакату и современной съёмке «0-24, не по теме канала»
  const rubric = rubricOf(item.rubric);
  const rubricBlock = rubric
    ? `\n${rubric.brief}\nЭти правила рубрики ВАЖНЕЕ общих критериев ниже там, где они расходятся.\n`
    : "";
  return `Ты отбираешь фотографии для русскоязычного телеграм-канала о
ВОЕННОЙ ТЕХНИКЕ И ВОЕННОЙ ИСТОРИИ - от Второй мировой (и техники 1930-х)
до наших дней - и готовишь к ним подписи. Сделай обе задачи за один раз.
Главное в канале - техника в кадре: танки, САУ, бронемашины, самолёты,
вертолёты, корабли, орудия. Исторические кадры без техники тоже выходят,
но реже.

${metadataBlock(item, extraContext)}${rubricBlock}
${SCORING_CRITERIA}

${captionRules(glossary)}

${FEW_SHOT}

subject_wiki - точное название статьи АНГЛИЙСКОЙ Википедии о технике в
кадре: тип или модель («T-34», «Panzer III», «Messerschmitt Bf 109»,
«Cromwell tank», «Soviet battleship Marat»). Только если техника названа в
метаданных или однозначно узнаётся; сомневаешься - пустая строка. По этой
статье редакция напишет цитату о лоре техники: выдуманное название даст
чужую статью.

event_wiki - статья АНГЛИЙСКОЙ Википедии о событии, частью которого был
кадр (битва, операция, парад), если оно названо в метаданных или
однозначно следует из них. Война целиком и кампания - не событие. Иначе -
пустая строка.

tags.story - тип сюжета поста, ровно один:
${storyGuide()}

Верни строго JSON без обёрток и без markdown:
{${SCORE_FIELDS_SCHEMA}, "caption": "<одно предложение, техника в **звёздочках**>", "date": "<дата снимка из метаданных или пустая строка>", "quote": "<познавательная справка о технике или событии или пустая строка>", "quote_kind": "context", "subject_wiki": "<статья о технике или пустая строка>", "event_wiki": "<статья о событии или пустая строка>"}`;
}

export async function analyzeImage(
  item: RawItem,
  cfg: AppConfig,
  image: Buffer,
  extraContext?: string,
  /** только полноценные модели - для второго мнения по отказам */
  opts: { fullOnly?: boolean } = {},
): Promise<Analysis> {
  const img = await imagePart(image);
  const result = await geminiJson<Analysis>(
    [{ text: buildAnalysisPrompt(item, cfg.glossary, extraContext) }, img],
    { fullOnly: opts.fullOnly },
  );
  // слабая модель может вернуть «"score": "high"» или забыть подпись: NaN
  // проходил порог оценки (NaN < 40 - ложь), а пустая подпись давала
  // пост из одной цитаты и ссылки. Такой ответ - брак, а не кандидат
  const score = Number(result.score);
  if (!Number.isFinite(score)) {
    throw new Error(`gemini: оценка не число (${JSON.stringify(result.score)})`);
  }
  if (!result.caption?.trim()) throw new Error("gemini: нет подписи в ответе");
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    score_why: result.score_why?.trim().slice(0, 120) || undefined,
    // тип сюжета - только из списка (src/story.ts); незнакомое не храним
    tags: (() => {
      const tags = { ...(result.tags ?? {}) };
      const story = normalizeStory(tags.story);
      if (story) tags.story = story;
      else delete tags.story;
      return tags;
    })(),
    unsafe: Boolean(result.unsafe),
    caption: result.caption ?? "",
    quote: result.quote ?? "",
    quote_place: undefined,
    date: typeof result.date === "string" ? result.date.trim().slice(0, 60) || undefined : undefined,
    quote_kind: result.quote_kind === "observation" ? "observation" : "context",
    subject_wiki: typeof result.subject_wiki === "string" ? result.subject_wiki.trim().slice(0, 120) || undefined : undefined,
    event_wiki:
      typeof result.event_wiki === "string" && !GENERIC_EVENT.test(result.event_wiki.trim())
        ? result.event_wiki.trim().slice(0, 120) || undefined
        : undefined,
    people: Array.isArray(result.people)
      ? result.people.filter((p): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 6)
      : undefined,
  };
}
