/**
 * Звёздочки в готовых подписях: модель помечает технику **так**, и до
 * правки 15.11 цитата уходила в базу со звёздочками как есть («на башне
 * **Pz.Kpfw. III**»). Здесь неопубликованные подписи чинятся: пара
 * звёздочек - жирный, одиночные - убираются. Без apply - только список.
 */
import { getDb, selectAll } from "../src/db.js";

export function fixStars(html: string): string {
  return html.replace(/\*\*([^*\n<>]+?)\*\*/g, "<b>$1</b>").replace(/\*/g, "");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();
  type Row = { id: number; status: string; caption_html: string | null };
  const rows = await selectAll<Row>((from, to) =>
    db
      .from("candidates")
      .select("id, status, caption_html")
      .in("status", ["new", "shown", "approved"])
      .like("caption_html", "%*%")
      .order("id")
      .range(from, to),
  );
  console.log(`подписей со звёздочками: ${rows.length}`);
  for (const r of rows) {
    const fixed = fixStars(r.caption_html ?? "");
    console.log(`\n#${r.id} [${r.status}]\n  было:  ${r.caption_html}\n  стало: ${fixed}`);
    if (!apply) continue;
    const { error } = await db.from("candidates").update({ caption_html: fixed }).eq("id", r.id);
    if (error) throw new Error(`#${r.id}: ${error.message}`);
  }
  if (!apply) console.log("\nпробный прогон: база не тронута (добавьте apply в маркер)");
}

if (process.argv[1]?.endsWith("fix-stars.ts")) {
  main().catch((err) => {
    console.error("правка упала:", err);
    process.exit(1);
  });
}
