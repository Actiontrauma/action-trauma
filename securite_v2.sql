-- =====================================================================
--  Action Trauma : sécurité par rôle (v2) + sauvegardes automatiques
--  À exécuter une fois dans Supabase > SQL Editor > Run.
--  Peut être relancé sans danger.
-- =====================================================================

-- 1. Employé relié au compte connecté
create or replace function public.at_my_emp() returns text
language sql stable security definer set search_path = public as $$
  select data->'users'->auth.uid()::text->>'emp' from at_docs where path = 'acces/roles' $$;
grant execute on function public.at_my_emp() to authenticated;

-- 2. Lecture selon le rôle
drop policy if exists at_read on public.at_docs;
create policy at_read on public.at_docs for select to authenticated using (
  case public.at_my_role()
    when 'admin'  then true
    when 'compta' then true
    when 'chef'   then true   -- voit tout, y compris les fiches personnelles (lecture seule : prive est réservé à l'admin en écriture)
    when 'employe' then
         col in ('config', 'acces')
      or path = 'prive/' || coalesce(public.at_my_emp(), '-')
      or (col = 'docs' and (
             (data->>'type' = 'soumission' and data->>'statut' in ('acceptee', 'facturee', 'archivee'))
          or (data->>'type' = 'facture' and data->>'statut' = 'brouillon' and coalesce(data->>'sourceId', '') = '')
          or (data->>'type' = 'facture' and public.at_my_emp() is not null
              and data->'heures' @> jsonb_build_array(jsonb_build_object('emp', public.at_my_emp())))
         ))
    else path = 'demandes/' || auth.uid()::text
  end);

-- 3. Écriture selon le rôle
--    config, acces, prive (fiches personnelles) : administrateur seulement
--    docs (soumissions, factures) : administrateur et chef ; la comptabilité peut modifier (paies)
--    orgs (clients) : administrateur et chef
--    employé : aucune écriture directe (sa disponibilité passe par at_toggle_dispo)
--    suppression : administrateur seulement
drop policy if exists at_insert on public.at_docs;
drop policy if exists at_update on public.at_docs;
drop policy if exists at_delete on public.at_docs;
create policy at_insert on public.at_docs for insert to authenticated with check (
  case when col in ('docs', 'orgs') then public.at_my_role() in ('admin', 'chef')
       when col = 'demandes' then path = 'demandes/' || auth.uid()::text or public.at_is_admin()
       else public.at_is_admin() end);
create policy at_update on public.at_docs for update to authenticated
  using (
  case when col = 'docs' then public.at_my_role() in ('admin', 'chef', 'compta')
       when col = 'orgs' then public.at_my_role() in ('admin', 'chef')
       when col = 'demandes' then path = 'demandes/' || auth.uid()::text or public.at_is_admin()
       else public.at_is_admin() end)
  with check (
  case when col = 'docs' then public.at_my_role() in ('admin', 'chef', 'compta')
       when col = 'orgs' then public.at_my_role() in ('admin', 'chef')
       when col = 'demandes' then path = 'demandes/' || auth.uid()::text or public.at_is_admin()
       else public.at_is_admin() end);
create policy at_delete on public.at_docs for delete to authenticated using (
  public.at_is_admin() or (col = 'demandes' and path = 'demandes/' || auth.uid()::text));

-- 4. Disponibilité d'un employé sur un quart (seule écriture permise à un employé)
create or replace function public.at_toggle_dispo(p_path text, p_qi int) returns boolean
language plpgsql security definer set search_path = public as $$
declare r text := public.at_my_role(); me text := public.at_my_emp(); d jsonb; q jsonb; disp jsonb; has boolean;
begin
  if r is null or me is null then raise exception 'Accès refusé'; end if;
  select data into d from at_docs where path = p_path and col = 'docs' for update;
  if d is null then raise exception 'Évènement introuvable'; end if;
  if not ((d->>'type' = 'soumission' and d->>'statut' in ('acceptee', 'facturee', 'archivee'))
       or (d->>'type' = 'facture' and d->>'statut' = 'brouillon')) then raise exception 'Évènement non disponible'; end if;
  q := d->'evenement'->'quarts'->p_qi;
  if q is null then raise exception 'Quart introuvable'; end if;
  disp := coalesce(q->'dispo', '[]'::jsonb);
  has := disp @> jsonb_build_array(me);
  if has then
    disp := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(disp) x where x <> to_jsonb(me));
  else
    disp := disp || jsonb_build_array(me);
  end if;
  update at_docs set data = jsonb_set(d, array['evenement', 'quarts', p_qi::text, 'dispo'], disp), updated_at = now() where path = p_path;
  return not has;
end $$;
revoke all on function public.at_toggle_dispo(text, int) from public, anon;
grant execute on function public.at_toggle_dispo(text, int) to authenticated;

-- 5. Sauvegardes : copies complètes conservées dans une table que seul l'administrateur peut lire
create table if not exists public.at_backups (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null default 'auto',
  nb int,
  data jsonb not null
);
alter table public.at_backups enable row level security;
drop policy if exists at_bk_read on public.at_backups;
create policy at_bk_read on public.at_backups for select to authenticated using (public.at_is_admin());
grant select on public.at_backups to authenticated;

create or replace function public.at_backup_now(p_kind text default 'manuelle') returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if auth.uid() is not null and not public.at_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  insert into at_backups(kind, nb, data)
    select coalesce(p_kind, 'manuelle'), count(*), coalesce(jsonb_object_agg(path, jsonb_build_object('col', col, 'data', data)), '{}'::jsonb) from at_docs
    returning id into nid;
  -- garder les 26 dernières sauvegardes automatiques (6 mois) et les 20 dernières des autres types
  delete from at_backups where kind = 'auto' and id not in (select id from at_backups where kind = 'auto' order by id desc limit 26);
  delete from at_backups where kind <> 'auto' and id not in (select id from at_backups where kind <> 'auto' order by id desc limit 20);
  return nid;
end $$;
revoke all on function public.at_backup_now(text) from public, anon;
grant execute on function public.at_backup_now(text) to authenticated;

-- Restaurer : remplace les données (sauf les accès et les demandes) par celles d'une sauvegarde.
-- Une sauvegarde « avant-restauration » est faite automatiquement juste avant.
create or replace function public.at_restore(p_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare b jsonb; n int;
begin
  if not public.at_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  select data into b from at_backups where id = p_id;
  if b is null then raise exception 'Sauvegarde introuvable'; end if;
  perform public.at_backup_now('avant-restauration');
  delete from at_docs where col not in ('acces', 'demandes');
  insert into at_docs(path, col, data, updated_at)
    select k, v->>'col', v->'data', now() from jsonb_each(b) as e(k, v) where v->>'col' not in ('acces', 'demandes')
    on conflict (path) do update set col = excluded.col, data = excluded.data, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.at_restore(bigint) from public, anon;
grant execute on function public.at_restore(bigint) to authenticated;

-- 6. Sauvegarde automatique chaque lundi à 3 h (heure de Montréal ≈ 8 h UTC)
create extension if not exists pg_cron;
select cron.schedule('at-backup-hebdo', '0 8 * * 1', $$select public.at_backup_now('auto')$$);

-- Première sauvegarde tout de suite
select public.at_backup_now('initiale');
