/**
 * Вернуть подписи, испорченные переписью резерва 23.11.
 *
 * Перепись пересобирала подпись первым заходом анализа, а не только
 * цитату: у #31 появились «генерал-майор Эривн Роммель», у #33 пропала
 * дата парада, у #16 - «(Cromwell tank)» и «Дорога в ад». Текст - из лога
 * прогона (БЫЛО), жирный - на названии техники, как в канале. Цитата
 * остаётся текущей. Только неопубликованные кадры.
 *
 * Вторая перепись 23.11 при сбое Gemini записала посты без цитаты:
 * «редактор пропущен», а запись всё равно шла. Цитаты #33, #37, #32
 * возвращаются дословно из лога (БЫЛО); у #37 и #32 снимается метка
 * переписи - их редактор посмотрит в следующий прогон.
 *
 *   npx tsx scripts/restore-body.ts [--apply]
 */
import { getDb } from "../src/db.js";
import { POST_FOOTER } from "../src/caption.js";
import { quoteFromHtml, swapQuote } from "../src/taken.js";

const QUOTES: Record<number, string> = {
  33: "Своим названием установка обязана первому прототипу, который оснащался двуствольной гаубицей для достижения высокой скорострельности. Позже нужных характеристик удалось добиться с одним стволом, но имя «Коалиция» решили сохранить.",
  37: "Крейсер типа «Каунти» вошёл в строй в 1928 году и во время войны служил флагманом эскадры ANZAC. Он поддерживал американские десантные операции в Коралловом море, на Гуадалканале и в заливе Лейте.",
  32: "Высадка десанта из машины осуществлялась сверху через люки в крыше корпуса. Начиная с 1974 года боевая машина пехоты Marder заменила HS.30 в Сухопутных войсках ФРГ.",
};
/** этим кадрам - снова в перепись */
const UNMARK = new Set([37, 32]);

function quoteHtml(q: string): string {
  const text = q.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `\n<blockquote${q.length > 200 ? " expandable" : ""}>${text}</blockquote>`;
}

const BODIES: Record<number, string> = {
  33: "152-мм самоходная артиллерийская установка <b>2С35 «Коалиция-СВ»</b> на улице Москвы во время проведения парада Победы. <i>9 мая 2015 года.</i>",
  31: "Трофейный британский бронеавтомобиль <b>AEC ACV «Dorchester»</b>, использовавшийся как подвижный штаб генерала Эрвина Роммеля в Северной Африке. <i>1942 год.</i>",
  16: "<b>Танки «Кромвель»</b> Гвардейской бронетанковой дивизии идут по «Адскому шоссе» в сторону Неймегена во время операции «Маркет-Гарден». <i>20 сентября 1944 года.</i>",
};

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();
  const { data, error } = await db
    .from("candidates")
    .select("id, caption_html, status, tags")
    .in("id", [...new Set([...Object.keys(BODIES), ...Object.keys(QUOTES)].map(Number))]);
  if (error) throw new Error(error.message);
  type Row = { id: number; caption_html: string | null; status: string; tags: Record<string, unknown> | null };
  for (const r of (data ?? []) as Row[]) {
    if (!["new", "shown", "approved"].includes(r.status) || !r.caption_html) {
      console.log(`#${r.id}: ${r.status} - не трогаю`);
      continue;
    }
    let html = BODIES[r.id] ? swapQuote(`${BODIES[r.id]}\n\n${POST_FOOTER}`, r.caption_html) : r.caption_html;
    // цитату возвращаем, только если её сейчас нет - не затираем новую
    const q = QUOTES[r.id];
    if (q && !quoteFromHtml(html)) html = swapQuote(html, `x${quoteHtml(q)}\n\n${POST_FOOTER}`);
    const tags = { ...(r.tags ?? {}) };
    if (UNMARK.has(r.id)) delete tags.requote;
    console.log(`#${r.id}\nБЫЛО:  ${r.caption_html}\nСТАЛО: ${html}`);
    if (!apply) continue;
    const { error: upErr } = await db
      .from("candidates")
      .update({ caption_html: html, tags })
      .eq("id", r.id)
      .in("status", ["new", "shown", "approved"]);
    console.log(upErr ? `  ! ${upErr.message}` : "  записано");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
