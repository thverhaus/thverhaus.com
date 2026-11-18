// Umboðsmenn, uppáhalds og nánari upplýsingar fyrir stjórnborð eiganda.
// Umboðsmaður = síða af tegundinni "agent". Eigandi samþykkir hverja slíka síðu.
// Umboðsmaður tengist böndum (agent_links); bandið samþykkir og getur losað sig.
// Viðburðir sem umboðsmaður setur inn fara beint inn á staði (nema staðurinn hafi hætt að treysta honum).

export const AGENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS favorites (user_id TEXT NOT NULL, page_id TEXT NOT NULL, PRIMARY KEY (user_id, page_id))`,
  `CREATE TABLE IF NOT EXISTS agent_links (agent_page_id TEXT NOT NULL, band_page_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', requested_by TEXT, created INTEGER, PRIMARY KEY (agent_page_id, band_page_id))`,
  `CREATE TABLE IF NOT EXISTS agent_blocks (venue_page_id TEXT NOT NULL, agent_page_id TEXT NOT NULL, PRIMARY KEY (venue_page_id, agent_page_id))`,
];

export function makeAgents(h) {
  const { json, err, readJson, str, now, newId, newCode } = h;
  const DB = (env) => env.DB;

  async function memberRole(env, user, pageId) {
    const r = await DB(env).prepare(`SELECT role FROM members WHERE page_id=? AND user_id=?`).bind(pageId, user.id).first();
    return r ? r.role : null;
  }
  // Umboðsmannasíða sem notandinn er í og er tengd bandinu (samþykkt), eða null.
  async function agentFor(env, user, bandPageId) {
    if (!user) return null;
    const r = await DB(env).prepare(
      `SELECT a.agent_page_id id FROM agent_links a JOIN pages ap ON ap.id=a.agent_page_id AND ap.status='approved'
       JOIN members m ON m.page_id=a.agent_page_id AND m.user_id=? WHERE a.band_page_id=? AND a.status='approved' LIMIT 1`
    ).bind(user.id, bandPageId).first();
    return r ? r.id : null;
  }
  // Má notandinn setja inn / breyta sem þessi síða? Skilar { role, agent }.
  async function postRole(env, user, pageId) {
    const role = await memberRole(env, user, pageId);
    if (role) return { role, agent: null };
    const agent = await agentFor(env, user, pageId);
    return agent ? { role: "agent", agent } : { role: null, agent: null };
  }
  async function agentBlocked(env, venuePageId, agentPageId) {
    return !!(await DB(env).prepare(`SELECT 1 FROM agent_blocks WHERE venue_page_id=? AND agent_page_id=?`).bind(venuePageId, agentPageId).first());
  }

  // Bönd sem notandinn sér um sem umboðsmaður (fyrir /api/me – birtast í „Setja inn sem“).
  async function agentPages(env, userId) {
    const r = await DB(env).prepare(
      `SELECT DISTINCT p.id,p.kind,p.name,p.place_id,p.status,'agent' role, ap.name agent_name
       FROM members m JOIN pages ap ON ap.id=m.page_id AND ap.kind='agent' AND ap.status='approved'
       JOIN agent_links a ON a.agent_page_id=ap.id AND a.status='approved' JOIN pages p ON p.id=a.band_page_id
       WHERE m.user_id=? AND p.id NOT IN (SELECT page_id FROM members WHERE user_id=?) ORDER BY p.name`
    ).bind(userId, userId).all();
    return r.results;
  }
  async function meExtras(env, user) {
    const fav = await DB(env).prepare(
      `SELECT p.id,p.kind,p.name,p.code,(SELECT COUNT(*) FROM members m WHERE m.page_id=p.id) n FROM favorites f JOIN pages p ON p.id=f.page_id WHERE f.user_id=? ORDER BY p.name`
    ).bind(user.id).all();
    // Beiðnir frá umboðsmönnum til banda sem notandinn stjórnar
    const ar = await DB(env).prepare(
      `SELECT a.agent_page_id,a.band_page_id,ap.name agent_name,bp.name band_name FROM agent_links a
       JOIN pages ap ON ap.id=a.agent_page_id JOIN pages bp ON bp.id=a.band_page_id
       JOIN members m ON m.page_id=a.band_page_id AND m.user_id=? AND m.role='admin' WHERE a.status='pending' ORDER BY a.created`
    ).bind(user.id).all();
    // Umboðsmenn tengdir böndum notandans
    const al = await DB(env).prepare(
      `SELECT a.agent_page_id,a.band_page_id,a.status,ap.name agent_name FROM agent_links a JOIN pages ap ON ap.id=a.agent_page_id
       JOIN members m ON m.page_id=a.band_page_id AND m.user_id=? WHERE a.status='approved'`
    ).bind(user.id).all();
    // Umboðsmannasíður notandans og bönd þeirra
    const mine = await DB(env).prepare(
      `SELECT p.id,p.name,p.status,m.role FROM members m JOIN pages p ON p.id=m.page_id AND p.kind='agent' WHERE m.user_id=? ORDER BY p.name`
    ).bind(user.id).all();
    const agents = [];
    for (const a of mine.results) {
      const bands = await DB(env).prepare(
        `SELECT bp.id,bp.name,bp.code,a.status,(SELECT COUNT(*) FROM members m WHERE m.page_id=bp.id) n FROM agent_links a JOIN pages bp ON bp.id=a.band_page_id WHERE a.agent_page_id=? ORDER BY bp.name`
      ).bind(a.id).all();
      agents.push({ ...a, bands: bands.results });
    }
    return { favorites: fav.results, agentRequests: ar.results, bandAgents: al.results, agents, agentPages: await agentPages(env, user.id) };
  }

  /* --- Uppáhalds --- */
  async function apiFavorite(req, env, user, pageId, add) {
    if (add) await DB(env).prepare(`INSERT OR IGNORE INTO favorites (user_id,page_id) VALUES (?,?)`).bind(user.id, pageId).run();
    else await DB(env).prepare(`DELETE FROM favorites WHERE user_id=? AND page_id=?`).bind(user.id, pageId).run();
    return json({ ok: true });
  }

  /* --- Umboðsmenn --- */
  async function createPage(env, kind, name, status) {
    for (let i = 0; i < 5; i++) {
      const id = newId("p");
      try {
        await DB(env).prepare(`INSERT INTO pages (id,kind,name,code,status,created) VALUES (?,?,?,?,?,?)`).bind(id, kind, name, newCode(), status, now()).run();
        return id;
      } catch (e) { if (!String(e).includes("UNIQUE")) throw e; }
    }
    throw new Error("Reyndu aftur.");
  }
  // Notandi sækir um að verða umboðsmaður → síða sem bíður samþykkis eiganda.
  async function apiAgentApply(req, env, user) {
    const b = (await readJson(req)) || {};
    const name = str(b.name, 100);
    if (!name) return err("Skrifaðu nafn umboðsskrifstofunnar eða þitt nafn.");
    const open = await DB(env).prepare(`SELECT p.id FROM members m JOIN pages p ON p.id=m.page_id AND p.kind='agent' AND p.status='pending' WHERE m.user_id=?`).bind(user.id).first();
    if (open) return err("Umsóknin þín bíður samþykkis.");
    const id = await createPage(env, "agent", name, user.is_owner ? "approved" : "pending");
    await DB(env).prepare(`INSERT INTO members (page_id,user_id,role) VALUES (?,?,'admin')`).bind(id, user.id).run();
    return json({ ok: true, id });
  }
  async function agentPageOfUser(env, user, agentId) {
    const p = await DB(env).prepare(`SELECT id,name,status FROM pages WHERE id=? AND kind='agent'`).bind(agentId).first();
    if (!p) return { error: err("Umboðsmaður fannst ekki.", 404) };
    if (!user.is_owner && !(await memberRole(env, user, agentId))) return { error: err("Þú ert ekki í þessari síðu.", 403) };
    if (p.status !== "approved") return { error: err("Umboðsmaðurinn hefur ekki verið samþykktur enn.", 403) };
    return { p };
  }
  // Umboðsmaður biður um að tengjast bandi. Band án meðlima tengist strax.
  async function apiAgentLink(req, env, user, agentId) {
    const a = await agentPageOfUser(env, user, agentId);
    if (a.error) return a.error;
    const b = (await readJson(req)) || {};
    const band = await DB(env).prepare(`SELECT id,name,kind FROM pages WHERE id=?`).bind(str(b.band, 60)).first();
    if (!band || band.kind !== "band") return err("Veldu hljómsveit / listamann.");
    const nm = await DB(env).prepare(`SELECT COUNT(*) n FROM members WHERE page_id=?`).bind(band.id).first();
    const status = nm && nm.n ? "pending" : "approved";
    await DB(env).prepare(`INSERT INTO agent_links (agent_page_id,band_page_id,status,requested_by,created) VALUES (?,?,?,?,?)
      ON CONFLICT(agent_page_id,band_page_id) DO UPDATE SET status=CASE WHEN status='approved' THEN 'approved' ELSE excluded.status END`)
      .bind(agentId, band.id, status, user.id, now()).run();
    return json({ ok: true, status, band: band.name });
  }
  // Umboðsmaður býr til síðu fyrir band sem er ekki á síðunni. Hann á ekki bandið – bandið gengur inn með kóða og getur losað sig.
  async function apiAgentNewBand(req, env, user, agentId) {
    const a = await agentPageOfUser(env, user, agentId);
    if (a.error) return a.error;
    const b = (await readJson(req)) || {};
    const name = str(b.name, 100);
    if (!name) return err("Nafn vantar.");
    const id = await createPage(env, "band", name, "approved");
    await DB(env).prepare(`INSERT INTO agent_links (agent_page_id,band_page_id,status,requested_by,created) VALUES (?,?,'approved',?,?)`).bind(agentId, id, user.id, now()).run();
    const p = await DB(env).prepare(`SELECT code FROM pages WHERE id=?`).bind(id).first();
    return json({ ok: true, id, code: p.code });
  }
  // approve / reject (stjórnandi bands), remove (stjórnandi bands, umboðsmaðurinn sjálfur eða eigandi)
  async function apiAgentLinkAction(req, env, user, agentId, bandId, action) {
    const link = await DB(env).prepare(`SELECT status FROM agent_links WHERE agent_page_id=? AND band_page_id=?`).bind(agentId, bandId).first();
    if (!link) return err("Tengingin fannst ekki.", 404);
    const bandRole = await memberRole(env, user, bandId);
    const agentRole = await memberRole(env, user, agentId);
    if (action === "approve" || action === "reject") {
      if (bandRole !== "admin" && !user.is_owner) return err("Aðeins stjórnendur hljómsveitarinnar.", 403);
      if (action === "approve") await DB(env).prepare(`UPDATE agent_links SET status='approved' WHERE agent_page_id=? AND band_page_id=?`).bind(agentId, bandId).run();
      else await DB(env).prepare(`DELETE FROM agent_links WHERE agent_page_id=? AND band_page_id=?`).bind(agentId, bandId).run();
    } else if (action === "remove") {
      if (!bandRole && !agentRole && !user.is_owner) return err("Þú mátt það ekki.", 403);
      await DB(env).prepare(`DELETE FROM agent_links WHERE agent_page_id=? AND band_page_id=?`).bind(agentId, bandId).run();
    } else return err("Ógild aðgerð.");
    return json({ ok: true });
  }
  // Staður: umboðsmenn sem hafa sett inn á staðinn, og hverjum hefur verið hætt að treysta.
  async function venueAgents(env, venuePageId) {
    const r = await DB(env).prepare(
      `SELECT DISTINCT ap.id,ap.name,(SELECT 1 FROM agent_blocks b WHERE b.venue_page_id=? AND b.agent_page_id=ap.id) blocked
       FROM events e JOIN pages vp ON vp.id=? AND vp.place_id=e.place_id JOIN pages ap ON ap.id=e.via_agent
       UNION SELECT ap.id,ap.name,1 FROM agent_blocks b JOIN pages ap ON ap.id=b.agent_page_id WHERE b.venue_page_id=?`
    ).bind(venuePageId, venuePageId, venuePageId).all();
    const seen = {};
    return r.results.filter((x) => (seen[x.id] ? false : (seen[x.id] = true)));
  }
  async function apiVenueAgentBlock(req, env, user, venuePageId, block) {
    if ((await memberRole(env, user, venuePageId)) !== "admin" && !user.is_owner) return err("Aðeins stjórnendur.", 403);
    const b = (await readJson(req)) || {};
    const agent = str(b.agent, 60);
    if (block) {
      await DB(env).batch([
        DB(env).prepare(`INSERT OR IGNORE INTO agent_blocks (venue_page_id,agent_page_id) VALUES (?,?)`).bind(venuePageId, agent),
        // Framtíðarviðburðir umboðsmannsins á staðnum fara í bið – staðurinn ræður.
        DB(env).prepare(`UPDATE events SET status='pending' WHERE via_agent=? AND status='approved' AND place_id=(SELECT place_id FROM pages WHERE id=?) AND date>=?`)
          .bind(agent, venuePageId, new Date().toISOString().slice(0, 10)),
      ]);
    } else await DB(env).prepare(`DELETE FROM agent_blocks WHERE venue_page_id=? AND agent_page_id=?`).bind(venuePageId, agent).run();
    return json({ ok: true });
  }

  /* --- Eigandi --- */
  async function apiAdminAgent(req, env, user, agentId, action) {
    if (!user.is_owner) return err("Aðeins eigandi.", 403);
    if (action === "approve") await DB(env).prepare(`UPDATE pages SET status='approved' WHERE id=? AND kind='agent'`).bind(agentId).run();
    else if (action === "reject") await DB(env).prepare(`UPDATE pages SET status='rejected' WHERE id=? AND kind='agent'`).bind(agentId).run();
    else return err("Ógild aðgerð.");
    return json({ ok: true });
  }
  // Allar síður með meðlimum og tengingum umboðsmanna (fyrir flipana í stjórnborðinu).
  async function adminPagesExtra(env) {
    const mem = await DB(env).prepare(`SELECT m.page_id,m.user_id,m.role,u.name,u.email,COALESCE(u.blocked,0) blocked FROM members m JOIN users u ON u.id=m.user_id`).all();
    const links = await DB(env).prepare(`SELECT a.agent_page_id,a.band_page_id,a.status,ap.name agent_name,bp.name band_name FROM agent_links a JOIN pages ap ON ap.id=a.agent_page_id JOIN pages bp ON bp.id=a.band_page_id`).all();
    return { members: mem.results, links: links.results };
  }
  async function adminUsersExtra(env) {
    const r = await DB(env).prepare(`SELECT m.user_id,m.role,p.id,p.name,p.kind FROM members m JOIN pages p ON p.id=m.page_id WHERE p.id NOT LIKE 'demo-%' ORDER BY p.name`).all();
    return r.results;
  }

  return { postRole, agentBlocked, meExtras, apiFavorite, apiAgentApply, apiAgentLink, apiAgentNewBand, apiAgentLinkAction, venueAgents, apiVenueAgentBlock, apiAdminAgent, adminPagesExtra, adminUsersExtra };
}
