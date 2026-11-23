/**
 * Справки из Википедии - легальный источник фактов для изюминки.
 *
 * Архив пишет, ЧТО на снимке («Allied observation balloon, Ypres 1917»),
 * но почти никогда - как это было устроено и чем удивительно. Раньше
 * единственной справкой была статья о СОБЫТИИ (по категории файла), и
 * изюминка превращалась в штабную сводку: цели наступления на Пашендаль,
 * узел снабжения 4-й армии. Читателю интереснее сам предмет в кадре:
 * аэростат, эсминец, танк. Модель называет его статью (subject_wiki), а
 * здесь мы достаём вступление - факты остаются документальными, не
 * выдуманными.
 */

import { isBlocked, noteRateLimit } from "./hostguard.js";

/**
 * Подпись для всех запросов к Викимедиа. Правила их API требуют в
 * User-Agent контакт - ссылку или почту; клиентов без контакта
 * датацентровые лимиты режут первыми.
 */
export const WIKIMEDIA_UA = "history-channel-bot/0.1 (https://github.com/Winston045/Tot_Sam; Telegram history channel)";
const UA = WIKIMEDIA_UA;
const INTRO_LIMIT = 1200;
/**
 * Справка о технике - не только вступление. Канал @War_ThunDep (23.11):
 * «факты о технике не должны быть банальными». Во вступлении статьи - самое
 * известное (кто создал, самый массовый); живые детали - в разделах о
 * конструкции, боевом применении, оценке и модификациях.
 */
const FULL_LIMIT = 7000;
const INTRO_IN_FULL = 700;
/** с одного раздела - не больше: иначе «История создания» съест весь лимит */
const SECTION_LIMIT = 1200;
/** разделы, где о технике пишут конкретику */
const TECH_SECTION =
  /конструкц|устройств|компоновк|вооружени|бронирован|броневая|двигател|ходов|подвижност|производ|выпуск|модифик|вариант|служб|эксплуатац|боев|применени|оценк|достоинств|недостат|испытан|истори[яи] (?:создания|разработки)|разработк|design|armament|armou?r|protection|engine|mobility|production|variant|service|combat|operational|assessment|evaluation|development|history/i;
/** разделы без фактов о машине */
const SKIP_SECTION =
  /примечани|литератур|ссылк|см\. также|источник|в культуре|в играх|в искусстве|памятник|сохранивш|музе|галере|notes|references|external|see also|bibliograph|further reading|popular culture|in fiction|surviving|survivors|gallery|museum/i;

/** Вступление и технические разделы полной статьи, до FULL_LIMIT знаков. */
export function techSections(extract: string): string {
  const parts = extract.split(/\n(={2,})\s*(.+?)\s*\1\n/);
  const squash = (t: string) => t.replace(/\s+/g, " ").trim();
  let out = squash(parts[0] ?? "").slice(0, INTRO_IN_FULL);
  let skipDepth = 0;
  for (let i = 1; i + 2 < parts.length + 1; i += 3) {
    const depth = (parts[i] ?? "").length;
    const head = parts[i + 1] ?? "";
    const body = squash(parts[i + 2] ?? "");
    if (skipDepth && depth > skipDepth) continue;
    skipDepth = 0;
    if (SKIP_SECTION.test(head)) {
      skipDepth = depth;
      continue;
    }
    if (!body || (!TECH_SECTION.test(head) && depth <= 2)) continue;
    const chunk = `\n[${head}] ${body.slice(0, SECTION_LIMIT)}`;
    if (out.length + chunk.length > FULL_LIMIT) {
      out += chunk.slice(0, Math.max(0, FULL_LIMIT - out.length));
      break;
    }
    out += chunk;
  }
  return out.trim();
}
const RETRIES = 1;
const RETRY_DELAY_MS = 2_000;
/** Пауза между запросами к Википедии: датацентровым адресам лимит строже. */
const MIN_GAP_MS = 1_000;
/** Сколько молчать после 429. */
const COOLDOWN_MS = 60_000;
let lastRequestAt = 0;
let cooldownUntil = 0;

/** Страница-развилка («может означать», «may refer to») - не справка. */
const DISAMBIGUATION = /may refer to|may also refer to|может означать|может относиться/i;

type WikiPage = {
  title?: string;
  missing?: boolean;
  extract?: string;
  langlinks?: Array<{ lang: string; title: string }>;
  pageprops?: { disambiguation?: string };
};

async function fetchPage(
  lang: string,
  title: string,
  withRuLink: boolean,
  full = false,
): Promise<WikiPage | undefined> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("prop", withRuLink ? "extracts|langlinks|pageprops" : "extracts|pageprops");
  if (!full) url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("titles", title);
  if (withRuLink) url.searchParams.set("lllang", "ru");

  // Вежливый темп и пауза после отказа. Полный сбор 22.10: Википедия
  // отвечала 429 на десятки запросов подряд - справка о событии перебирала
  // по восемь статей на кадр и выжигала лимит, и до справки о предмете в
  // кадре (ради неё всё и затевалось) очередь не доходила
  if (Date.now() < cooldownUntil || isBlocked(url)) return undefined;
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { query?: { pages?: WikiPage[] } };
        return body.query?.pages?.[0];
      }
      if (res.status === 429) {
        // повтор через пару секунд только продлит отказ - пауза на минуту,
        // а второй отказ после паузы - Википедия до конца прогона отдыхает
        cooldownUntil = Date.now() + COOLDOWN_MS;
        noteRateLimit(url);
        console.warn(`  википедия: 429 на «${title}» - пауза ${COOLDOWN_MS / 1000} с`);
        return undefined;
      }
      if (res.status < 500) return undefined;
      if (attempt >= RETRIES) console.warn(`  википедия ${lang}: «${title}» → HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= RETRIES) {
        console.warn(`  википедия ${lang}: «${title}» → ${(err as Error).message}`);
        throw err;
      }
    }
    if (attempt >= RETRIES) return undefined;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
}

function usable(page: WikiPage | undefined, full = false): string | undefined {
  if (!page || page.missing || !page.extract) return undefined;
  if (page.pageprops?.disambiguation !== undefined) return undefined;
  const text = page.extract.replace(/\s+/g, " ").trim();
  if (text.length < 120 || DISAMBIGUATION.test(text.slice(0, 300))) return undefined;
  return full ? techSections(page.extract) : text.slice(0, INTRO_LIMIT);
}

/** Вступление статьи по точному названию; undefined - нет статьи или это развилка. */
export async function wikiIntro(lang: string, title: string, full = false): Promise<string | undefined> {
  try {
    return usable(await fetchPage(lang, title, false, full), full);
  } catch {
    return undefined;
  }
}

/**
 * Вступление статьи по английскому названию: русская версия, если она
 * есть (точнее в терминах: «привязной аэростат», а не калька), иначе
 * английская. Сбой сети - не повод ронять кадр: справки просто не будет.
 */
async function reference(enTitle: string, full = false): Promise<{ name: string; text: string } | undefined> {
  // «AEC_Dorchester» - модель иногда пишет название как в адресе статьи
  const title = enTitle.replace(/_/g, " ").trim();
  if (!title || title.length > 120) return undefined;
  try {
    const en = await fetchPage("en", title, true, full);
    const enText = usable(en, full);
    if (!enText) return undefined; // развилка или не та статья - лучше без справки
    const ruTitle = en?.langlinks?.find((l) => l.lang === "ru")?.title;
    const ruText = ruTitle ? await wikiIntro("ru", ruTitle, full) : undefined;
    return { name: (ruText ? ruTitle : en?.title) ?? title, text: ruText ?? enText };
  } catch {
    return undefined;
  }
}

/** Справка о предмете в кадре: технике, корабле, явлении или человеке. */
export async function subjectReference(enTitle: string): Promise<string | undefined> {
  const ref = await reference(enTitle, true);
  return ref
    ? `Справка из Википедии о предмете в кадре («${ref.name}»), использовать только если она точно про то, что на фото:\n${ref.text}`
    : undefined;
}

/**
 * Справка о знаковом событии, частью которого был кадр (Пражская весна,
 * экспедиция Скотта, Сталинградская битва). Редакция 08.11: «Барк «Терра
 * Нова» во льдах. Антарктида, 1910» - пост без ставок, хотя из этой
 * экспедиции Скотт не вернулся. Справка нужна для одной-двух фраз о том,
 * что это было и чем кончилось для людей в кадре, - не для штабной сводки.
 */
export async function eventReference(enTitle: string): Promise<string | undefined> {
  const ref = await reference(enTitle);
  return ref
    ? `Справка из Википедии о событии, частью которого был кадр («${ref.name}»): для одной-двух фраз о том, что это было и чем кончилось для людей в кадре; не для пересказа хода операций:\n${ref.text}`
    : undefined;
}
