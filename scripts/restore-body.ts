/**
 * Вернуть подписи, испорченные переписью резерва 23.11.
 *
 * Перепись пересобирала подпись первым заходом анализа, а не только
 * цитату: у #31 появились «генерал-майор Эривн Роммель», у #33 пропала
 * дата парада, у #16 - «(Cromwell tank)» и «Дорога в ад». Текст - из лога
 * прогона (БЫЛО), жирный - на названии техники, как в канале. Цитата
 * остаётся текущей. Только неопубликованные кадры.
 *
 *   npx tsx scripts/restore-body.ts [--apply]
 */
import { getDb } from "../src/db.js";
import { POST_FOOTER } from "../src/caption.js";
import { swapQuote } from "../src/taken.js";

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
    .select("id, caption_html, status")
    .in("id", Object.keys(BODIES).map(Number));
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as Array<{ id: number; caption_html: string | null; status: string }>) {
    if (!["new", "shown", "approved"].includes(r.status) || !r.caption_html) {
      console.log(`#${r.id}: ${r.status} - не трогаю`);
      continue;
    }
    const html = swapQuote(`${BODIES[r.id]}\n\n${POST_FOOTER}`, r.caption_html);
    console.log(`#${r.id}\nБЫЛО:  ${r.caption_html}\nСТАЛО: ${html}`);
    if (!apply) continue;
    const { error: upErr } = await db
      .from("candidates")
      .update({ caption_html: html })
      .eq("id", r.id)
      .in("status", ["new", "shown", "approved"]);
    console.log(upErr ? `  ! ${upErr.message}` : "  записано");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
