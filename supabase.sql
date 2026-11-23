-- Action Trauma — base de données de la version autonome
-- À coller une seule fois dans Supabase : menu « SQL Editor » → « New query » → coller → « Run ».

create extension if not exists pgcrypto with schema extensions;

-- 1. Une seule table qui contient tous les documents (soumissions, factures, clients, paramètres, accès)
create table if not exists public.at_docs (
  path text primary key,            -- ex. docs/f190, orgs/o07, config/entreprise, acces/roles
  col text not null,                -- docs, orgs, config, acces
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.at_docs replica identity full;

-- 2. Rôle de l'utilisateur connecté : 'admin', 'chef', 'compta' ou null (aucun accès)
create or replace function public.at_my_role() returns text
language plpgsql stable security definer set search_path = public as $$
declare owner text; r text; nb int;
begin
  if auth.uid() is null then return null; end if;
  select data->>'ownerId' into owner from at_docs where path = 'config/entreprise';
  if owner = auth.uid()::text then return 'admin'; end if;
  select data->'users'->auth.uid()::text->>'role' into r from at_docs where path = 'acces/roles';
  if r in ('admin','chef','compta') then return r; end if;
  -- Démarrage : tant qu'aucun propriétaire n'est défini, le tout premier utilisateur est administrateur
  if owner is null then
    select count(*) into nb from at_docs where path = 'acces/roles' and jsonb_typeof(data->'users') = 'object' and data->'users' <> '{}'::jsonb;
    if nb = 0 then return 'admin'; end if;
  end if;
  return null;
end $$;

create or replace function public.at_is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select public.at_my_role() = 'admin' $$;
create or replace function public.at_is_member() returns boolean
language sql stable security definer set search_path = public as $$ select public.at_my_role() is not null $$;

-- 3. Sécurité : seuls les utilisateurs ayant un rôle voient les données;
--    seuls les administrateurs modifient les paramètres (config) et les accès (acces).
alter table public.at_docs enable row level security;
drop policy if exists at_read on public.at_docs;
drop policy if exists at_insert on public.at_docs;
drop policy if exists at_update on public.at_docs;
drop policy if exists at_delete on public.at_docs;
create policy at_read on public.at_docs for select to authenticated using (public.at_is_member());
create policy at_insert on public.at_docs for insert to authenticated
  with check (case when col in ('config','acces') then public.at_is_admin() else public.at_is_member() end);
create policy at_update on public.at_docs for update to authenticated
  using (case when col in ('config','acces') then public.at_is_admin() else public.at_is_member() end)
  with check (case when col in ('config','acces') then public.at_is_admin() else public.at_is_member() end);
create policy at_delete on public.at_docs for delete to authenticated
  using (case when col in ('config','acces') then public.at_is_admin() else public.at_is_member() end);

-- 4. Mise à jour en direct sur tous les appareils
do $$ begin
  alter publication supabase_realtime add table public.at_docs;
exception when duplicate_object then null; end $$;

-- 5. L'administrateur peut changer le mot de passe d'un utilisateur
create or replace function public.at_set_password(uid uuid, pw text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.at_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  if length(pw) < 8 then raise exception 'Le mot de passe doit avoir au moins 8 caractères'; end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now() where id = uid;
end $$;

-- 6. L'administrateur peut supprimer le compte d'un utilisateur retiré
create or replace function public.at_delete_user(uid uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.at_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  if uid = auth.uid() then raise exception 'Impossible de supprimer ton propre compte'; end if;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.at_set_password(uuid, text) from public, anon;
revoke all on function public.at_delete_user(uuid) from public, anon;
grant execute on function public.at_set_password(uuid, text) to authenticated;
grant execute on function public.at_delete_user(uuid) to authenticated;
grant execute on function public.at_my_role() to authenticated;
grant select, insert, update, delete on public.at_docs to authenticated;

-- 7. Abonnement au calendrier (Outlook) : jeton secret du lien, lisible seulement par la fonction « ics »
create table if not exists public.at_ics (id int primary key default 1 check (id = 1), token text not null);
alter table public.at_ics enable row level security;
create or replace function public.at_ics_token(regen boolean default false) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare t text;
begin
  if not public.at_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  select token into t from at_ics where id = 1;
  if t is null or regen then
    t := encode(extensions.gen_random_bytes(24), 'hex');
    insert into at_ics(id, token) values (1, t) on conflict (id) do update set token = excluded.token;
  end if;
  return t;
end $$;
revoke all on function public.at_ics_token(boolean) from public, anon;
grant execute on function public.at_ics_token(boolean) to authenticated;
