/**
 * Чистка резерва канала @War_ThunDep: только техника. Кадры, у которых
 * анализ не отметил технику в кадре (tags.tech !== true, в том числе
 * разобранные до появления тега), снимаются статусом rejected с пометкой
 * gate=notech. Опубликованное не трогаем. Без apply - только список.
 */
import { getDb, selectAll } from "../src/db.js";

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();
  type Row = { id: number; status: string; raw_title: string | null; tags: Record<string, unknown> | null };
  const rows = await selectAll<Row>((from, to) =>
    db
      .from("candidates")
      .select("id, status, raw_title, tags")
      .in("status", ["new", "shown", "approved"])
      .order("id")
      .range(from, to),
  );
  const drop = rows.filter((r) => r.tags?.tech !== true);
  console.log(`в резерве: ${rows.length}; с техникой ${rows.length - drop.length}, без неё ${drop.length}\n`);
  for (const r of drop) console.log(`  снимается #${r.id} [${r.status}] ${(r.raw_title ?? "").slice(0, 90)}`);
  if (!apply) {
    console.log("\nпробный прогон: база не тронута (добавьте apply в маркер)");
    return;
  }
  for (const r of drop) {
    const { error } = await db
      .from("candidates")
      .update({ status: "rejected", tags: { ...(r.tags ?? {}), gate: "notech" } })
      .eq("id", r.id)
      .in("status", ["new", "shown", "approved"]);
    if (error) throw new Error(`#${r.id}: ${error.message}`);
  }
  console.log(`\nснято из резерва: ${drop.length}`);
}

main().catch((err) => {
  console.error("чистка упала:", err);
  process.exit(1);
});
