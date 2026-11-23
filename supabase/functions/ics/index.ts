// Action Trauma — lien d'abonnement au calendrier (Outlook, Google, Apple)
// Fonction Supabase « ics » : à créer avec l'option « Verify JWT » désactivée.
import { createClient } from "npm:@supabase/supabase-js@2";

// Construit le fichier .ics à partir des documents (soumissions / factures)
function buildIcs(docs: any[], nowIso: string) {
  const byId: Record<string, any> = {}; docs.forEach(d => { if (d && d.id) byId[d.id] = d; });
  const factOf = s => {
    let f = s.factureId ? byId[s.factureId] : null;
    if (f && f.sourceId && f.sourceId !== s.id) f = null;
    return f || docs.find(x => x.type === "facture" && x.sourceId === s.id) || null;
  };
  const items: any[] = [];
  docs.forEach(d => {
    if (d.type === "soumission" && ["acceptee", "facturee", "archivee"].includes(d.statut)) {
      const f = factOf(d); if (f && f.statut === "annulee") return; items.push({ d, f });
    } else if (d.type === "facture" && !d.sourceId && d.statut !== "annulee") items.push({ d, f: d });
  });
  const esc = v => String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = line => { const out: string[] = []; let cur = "", n = 0;
    for (const ch of line) { const b = new TextEncoder().encode(ch).length; if (n + b > 74) { out.push(cur); cur = " " + ch; n = 1 + b; } else { cur += ch; n += b; } }
    out.push(cur); return out.join("\r\n"); };
  const ymd = s => String(s).replace(/-/g, "");
  const hm = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? m[1].padStart(2, "0") + m[2] + "00" : null; };
  const addDay = s => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  const nfH = t => t ? String(t).replace(/^0(\d)/, "$1").replace(":", " h ") : "";
  const stamp = nowIso.replace(/[-:]/g, "").replace(/\.\d+/, "").slice(0, 15) + "Z";
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Action Trauma//Evenements//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Action Trauma – Évènements", "X-WR-TIMEZONE:America/Toronto", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    "BEGIN:VTIMEZONE", "TZID:America/Toronto",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
    "END:VTIMEZONE"];
  let count = 0;
  items.forEach(({ d, f }) => {
    const e = d.evenement || {}, J = (e.jours || []).filter(j => j && j.date);
    const days = J.length ? J : (e.date ? [{ date: e.date }] : []);
    days.forEach((j, k) => {
      const s = hm(j.debut), en = hm(j.fin);
      const nom = (e.nom || (d.client && d.client.entreprise) || "Évènement") + (days.length > 1 ? ` (jour ${k + 1}/${days.length})` : "");
      const desc = [d.client && d.client.entreprise ? "Client : " + d.client.entreprise + (d.client.contact ? " (" + d.client.contact + ")" : "") : "",
        (d.type === "soumission" ? "Soumission S" : "Facture F") + d.numero + (f && f !== d ? " · Facture F" + f.numero : ""),
        j.debut ? "Horaire : " + nfH(j.debut) + (j.fin ? " à " + nfH(j.fin) : "") : "",
        e.infos ? "\n" + e.infos : ""].filter(Boolean).join("\n");
      L.push("BEGIN:VEVENT", "UID:" + d.id + "-" + j.date + "@actiontrauma.ca", "DTSTAMP:" + stamp);
      if (s) {
        L.push("DTSTART;TZID=America/Toronto:" + ymd(j.date) + "T" + s);
        if (en) L.push("DTEND;TZID=America/Toronto:" + ymd(en <= s ? addDay(j.date) : j.date) + "T" + en);
        else L.push("DURATION:PT1H");
      } else { L.push("DTSTART;VALUE=DATE:" + ymd(j.date), "DTEND;VALUE=DATE:" + ymd(addDay(j.date))); }
      L.push("SUMMARY:" + esc(nom));
      if (e.adresse) L.push("LOCATION:" + esc(e.adresse));
      L.push("DESCRIPTION:" + esc(desc), "STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT");
      count++;
    });
  });
  L.push("END:VCALENDAR");
  return { ics: L.map(fold).join("\r\n") + "\r\n", count };
}

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); key = o.default || Object.values(o)[0] || key; } catch (_) { /* clés classiques */ }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key as string, { auth: { persistSession: false } });
  const { data: tok } = await sb.from("at_ics").select("token").eq("id", 1).maybeSingle();
  if (!t || !tok || t !== tok.token) return new Response("Lien d'abonnement invalide.", { status: 403 });
  const docs: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("at_docs").select("path,data").eq("col", "docs").range(from, from + 999);
    if (error) return new Response("Erreur : " + error.message, { status: 500 });
    (data || []).forEach((r: any) => docs.push({ ...r.data, id: String(r.path).split("/").pop() }));
    if (!data || data.length < 1000) break;
  }
  const { ics } = buildIcs(docs, new Date().toISOString());
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "inline; filename=action-trauma.ics", "Cache-Control": "no-cache" } });
});
