// Eins skiptis: afritar gamla gagnagrunninn (Ameríka, env.DB) yfir í nýjan í Evrópu (env.NEWDB).
// Keyrt í litlum skrefum (vegna CPU-marka á Workers Free) með /api/dbcopy?t=<lykill>.
// Lykillinn er geymdur í meta-töflu gamla grunnsins (dbcopy_token). Fjarlægt eftir flutninginn.
const SKIP = /^(sqlite_|_cf_|d1_)/;
const STEP = 100;

export async function dbCopyStep(env, token) {
  if (!env.NEWDB) return { error: "NEWDB vantar" };
  const tk = await env.DB.prepare(`SELECT v FROM meta WHERE k='dbcopy_token'`).first();
  if (!tk || !token || tk.v !== token) return { error: "rangur lykill" };
  const N = env.NEWDB;
  await N.prepare(`CREATE TABLE IF NOT EXISTS _copy (t TEXT PRIMARY KEY, off INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0)`).run();
  const objs = (await env.DB.prepare(`SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type='index', name`).all()).results
    .filter((o) => !SKIP.test(o.name));
  const tables = objs.filter((o) => o.type === "table").map((o) => o.name);
  // 1) Uppbygging (töflur og vísar) – einu sinni
  const st = await N.prepare(`SELECT done FROM _copy WHERE t='__schema'`).first();
  if (!st) {
    const stmts = objs.map((o) => N.prepare(o.sql.replace(/^CREATE (UNIQUE )?(TABLE|INDEX) (IF NOT EXISTS )?/i, (m, u, k) => `CREATE ${u || ""}${k} IF NOT EXISTS `)));
    stmts.push(N.prepare(`INSERT INTO _copy (t,done) VALUES ('__schema',1)`));
    await N.batch(stmts);
    return { step: "schema", tables };
  }
  // 2) Gögn, tafla fyrir töflu
  for (const t of tables) {
    const row = await N.prepare(`SELECT off,done FROM _copy WHERE t=?`).bind(t).first();
    if (row && row.done) continue;
    const off = row ? row.off : 0;
    const rows = (await env.DB.prepare(`SELECT * FROM "${t}" ORDER BY rowid LIMIT ? OFFSET ?`).bind(STEP, off).all()).results;
    const stmts = rows.map((r) => {
      const cols = Object.keys(r);
      return N.prepare(`INSERT OR REPLACE INTO "${t}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((c) => r[c]));
    });
    const done = rows.length < STEP ? 1 : 0;
    stmts.push(N.prepare(`INSERT INTO _copy (t,off,done) VALUES (?,?,?) ON CONFLICT(t) DO UPDATE SET off=excluded.off, done=excluded.done`).bind(t, off + rows.length, done));
    await N.batch(stmts);
    return { step: t, copied: off + rows.length, done: !!done };
  }
  // 3) Samanburður
  const cmp = {};
  for (const t of tables) {
    const a = await env.DB.prepare(`SELECT count(*) n FROM "${t}"`).first();
    const b = await N.prepare(`SELECT count(*) n FROM "${t}"`).first();
    cmp[t] = [a.n, b.n];
  }
  return { finished: true, cmp };
}
