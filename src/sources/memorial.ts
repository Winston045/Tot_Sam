/**
 * memorial.orbitnetwork.ru - подборки документальных фото Второй мировой
 * на WordPress. Источник выбран владельцем канала @War_ThunDep: у каждого
 * фото уже есть точная подпись в стиле канала («Немцы едут на захваченном
 * советском танке КВ-1.»), бот её только оформляет.
 *
 * Проба 15.11 с раннера GitHub: открытый REST WordPress (/wp-json/wp/v2),
 * 25 записей и несколько страниц, фото лежат в <figure> с <figcaption>.
 * Источник небольшой - сотни кадров, - поэтому идём по плоскому списку
 * всех фото курсором и не перечитываем уже пройденное.
 */
import type { SourceConfig } from "../config.js";
import type { CursorStore } from "../cursors.js";
import type { RawItem, SourceAdapter } from "./types.js";

const BASE = "https://memorial.orbitnetwork.ru";
const UA = "Mozilla/5.0 (compatible; history-channel-bot/1.0)";

type WpEntry = { link: string; content?: { rendered?: string } };

function decode(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8230;/g, "…")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Полноразмерный файл вместо миниатюры WordPress: «foto-508x353.jpeg» → «foto.jpeg». */
export function fullSize(src: string): string {
  return src.replace(/^http:/, "https:").replace(/-\d+x\d+(\.(?:jpe?g|png|webp))$/i, "$1");
}

/** Год снимка из подписи («1943 год», «1942г.», «1944 года»), только 1930-2029. */
export function yearFromCaption(caption: string): number | undefined {
  const m = caption.match(/\b(19[3-9]\d|20[0-2]\d)\s*(?:г\.?|год|года|году)?/);
  return m ? Number(m[1]) : undefined;
}

/** Фото с подписями из HTML записи WordPress. */
export function figuresOf(html: string, link: string): RawItem[] {
  const out: RawItem[] = [];
  for (const fig of html.match(/<figure[\s\S]*?<\/figure>/g) ?? []) {
    const src = fig.match(/<img[^>]+(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp))"/i)?.[1];
    const capHtml = fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/)?.[1];
    if (!src || !capHtml) continue;
    // подписи пронумерованы («75 Пленный немецкий солдат...») - номер не нужен
    const caption = decode(capHtml).replace(/^\d{1,3}\s+(?=\p{Lu})/u, "");
    if (caption.length < 15) continue;
    const imageUrl = fullSize(src);
    const file = imageUrl.replace(/^.*\/uploads\//, "");
    const width = Number(fig.match(/width="(\d+)"/)?.[1]);
    out.push({
      sourceId: file,
      sourceUrl: `${link}#${encodeURIComponent(file)}`,
      imageUrl,
      title: caption,
      description: caption,
      lang: "ru",
      year: yearFromCaption(caption),
      license: "memorial.orbitnetwork.ru",
      attribution: "memorial.orbitnetwork.ru",
      // у миниатюры ширина своя; полный файл не меньше её
      imageWidth: Number.isFinite(width) && width > 0 && !/-\d+x\d+\./.test(src) ? width : undefined,
      curated: true,
    });
  }
  return out;
}

async function wp(kind: "posts" | "pages", page: number): Promise<WpEntry[]> {
  const url = `${BASE}/wp-json/wp/v2/${kind}?per_page=100&page=${page}&_fields=link,content`;
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  // страница за пределами списка - 400 у WordPress, это конец, а не ошибка
  if (res.status === 400) return [];
  if (!res.ok) throw new Error(`memorial: ${kind} p${page} → HTTP ${res.status}`);
  return (await res.json()) as WpEntry[];
}

/** Все фото сайта в стабильном порядке. */
async function allFigures(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const seen = new Set<string>();
  for (const kind of ["pages", "posts"] as const) {
    for (let page = 1; page <= 5; page++) {
      const entries = await wp(kind, page);
      for (const e of entries) {
        for (const it of figuresOf(e.content?.rendered ?? "", e.link)) {
          if (seen.has(it.sourceId)) continue;
          seen.add(it.sourceId);
          items.push(it);
        }
      }
      if (entries.length < 100) break;
    }
  }
  return items;
}

export const memorial: SourceAdapter = {
  name: "memorial",

  async fetch(limit: number, _cfg: SourceConfig, cursors: CursorStore): Promise<RawItem[]> {
    const all = await allFigures();
    if (all.length === 0) return [];
    const start = (await cursors.get("memorial", "offset")) % all.length;
    const batch: RawItem[] = [];
    for (let i = 0; i < Math.min(limit, all.length); i++) {
      const it = all[(start + i) % all.length];
      if (it) batch.push(it);
    }
    await cursors.set("memorial", "offset", (start + batch.length) % all.length);
    return batch;
  },

  async details(item: RawItem): Promise<string | undefined> {
    return item.description;
  },
};
