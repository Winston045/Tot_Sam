/**
 * Цитаты, которые о той же технике уже есть в канале или резерве.
 *
 * Канал @War_ThunDep (23.11): у Т-34 десятки кадров, и редактор, читая одну
 * и ту же справку, писал под каждым один факт - «дизель В-2 дал высокую
 * удельную мощность». Список уже взятых цитат уходит редактору, и он берёт
 * из справки другой факт.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Текст цитаты из готового caption_html; пусто - цитаты нет. */
export function quoteFromHtml(html: string | null | undefined): string {
  const m = (html ?? "").match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/);
  if (!m?.[1]) return "";
  return m[1]
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Новая цитата под старой подписью. Перепись резерва 23.11 меняла и
 * подпись: первый заход анализа пересобирал её заново и ронял детали
 * (дата парада) или вносил ошибки («генерал-майор Эривн Роммель»).
 * Владелец к подписям претензий не имел - меняется только цитата.
 */
export function swapQuote(oldHtml: string, newHtml: string): string {
  const quote = newHtml.match(/\n<blockquote[^>]*>[\s\S]*?<\/blockquote>/)?.[0] ?? "";
  const cut = oldHtml.search(/\n<blockquote|\n\n/);
  const body = cut >= 0 ? oldHtml.slice(0, cut) : oldHtml;
  const footer = oldHtml.match(/\n\n[^\n]*$/)?.[0] ?? "";
  return `${body}${quote}${footer}`;
}

type Row = { id: number; caption_html: string | null; status: string; tags: Record<string, unknown> | null };

/** Цитаты вышедших и резервных постов о той же технике, кроме самого кадра. */
export async function loadTakenQuotes(
  db: SupabaseClient,
  subjectWiki: string | undefined,
  exceptId?: number,
  filter: (row: Row) => boolean = () => true,
): Promise<string[]> {
  const subject = subjectWiki?.trim();
  if (!subject) return [];
  const { data, error } = await db
    .from("candidates")
    .select("id, caption_html, status, tags")
    .eq("tags->>subject_wiki", subject)
    .in("status", ["new", "shown", "approved", "published"])
    .order("id", { ascending: false })
    .limit(40);
  if (error) return [];
  return ((data ?? []) as Row[])
    .filter((r) => r.id !== exceptId && filter(r))
    .map((r) => quoteFromHtml(r.caption_html))
    .filter((q) => q.length > 0);
}
