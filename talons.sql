-- =====================================================================
--  Action Trauma : talons de paie (stockage privé + accès par rôle)
--  À exécuter une fois dans Supabase > SQL Editor > Run. Peut être relancé.
-- =====================================================================

-- 1. Espace de fichiers privé « talons » (PDF ou image, 10 Mo max)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('talons', 'talons', false, 10485760, array['application/pdf','image/jpeg','image/png','image/heic','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Fichiers : la comptabilité et l'administrateur déposent et gèrent tout ;
-- chaque employé (ou chef) lit seulement les fichiers de son propre dossier.
drop policy if exists at_talons_read on storage.objects;
drop policy if exists at_talons_ins on storage.objects;
drop policy if exists at_talons_upd on storage.objects;
drop policy if exists at_talons_del on storage.objects;
create policy at_talons_read on storage.objects for select to authenticated using (
  bucket_id = 'talons' and (public.at_my_role() in ('admin', 'compta') or (storage.foldername(name))[1] = public.at_my_emp()));
create policy at_talons_ins on storage.objects for insert to authenticated with check (
  bucket_id = 'talons' and public.at_my_role() in ('admin', 'compta'));
create policy at_talons_upd on storage.objects for update to authenticated using (
  bucket_id = 'talons' and public.at_my_role() in ('admin', 'compta'));
create policy at_talons_del on storage.objects for delete to authenticated using (
  bucket_id = 'talons' and public.at_my_role() in ('admin', 'compta'));

-- 2. Fiches des talons (col 'talons') : mêmes règles
drop policy if exists at_read on public.at_docs;
create policy at_read on public.at_docs for select to authenticated using (
  case public.at_my_role()
    when 'admin'  then true
    when 'compta' then true
    when 'chef'   then col <> 'talons' or data->>'emp' = coalesce(public.at_my_emp(), '-')
    when 'employe' then
         col in ('config', 'acces')
      or path = 'prive/' || coalesce(public.at_my_emp(), '-')
      or (col = 'talons' and data->>'emp' = coalesce(public.at_my_emp(), '-'))
      or (col = 'docs' and (
             (data->>'type' = 'soumission' and data->>'statut' in ('acceptee', 'facturee', 'archivee'))
          or (data->>'type' = 'facture' and data->>'statut' = 'brouillon' and coalesce(data->>'sourceId', '') = '')
          or (data->>'type' = 'facture' and public.at_my_emp() is not null
              and data->'heures' @> jsonb_build_array(jsonb_build_object('emp', public.at_my_emp())))
         ))
    else path = 'demandes/' || auth.uid()::text
  end);

drop policy if exists at_insert on public.at_docs;
drop policy if exists at_update on public.at_docs;
drop policy if exists at_delete on public.at_docs;
create policy at_insert on public.at_docs for insert to authenticated with check (
  case when col in ('docs', 'orgs') then public.at_my_role() in ('admin', 'chef')
       when col = 'talons' then public.at_my_role() in ('admin', 'compta')
       when col = 'demandes' then path = 'demandes/' || auth.uid()::text or public.at_is_admin()
       else public.at_is_admin() end);
create policy at_update on public.at_docs for update to authenticated
  using (
  case when col = 'docs' then public.at_my_role() in ('admin', 'chef', 'compta')
       when col = 'orgs' then public.at_my_role() in ('admin', 'chef')
       when col = 'talons' then public.at_my_role() in ('admin', 'compta')
       when col = 'demandes' then path = 'demandes/' || auth.uid()::text or public.at_is_admin()
       else public.at_is_admin() end)
  with check (
  case when col = 'docs' then public.at_my_role() in ('admin', 'chef', 'compta')
       when col = 'orgs' then public.at_my_role() in ('admin', 'chef')
       when col = 'talons' then public.at_my_role() in ('admin', 'compta')
       when col = 'demandes' then path = 'demandes/' || auth.uid()::text or public.at_is_admin()
       else public.at_is_admin() end);
create policy at_delete on public.at_docs for delete to authenticated using (
  public.at_is_admin()
  or (col = 'talons' and public.at_my_role() = 'compta')
  or (col = 'demandes' and path = 'demandes/' || auth.uid()::text));
