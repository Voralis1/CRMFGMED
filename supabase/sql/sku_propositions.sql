-- =============================================================================
-- LE VENDEUR PROPOSE UN SKU, UN RESPONSABLE L'APPROUVE — 11/11/2026 (sa décision : option C)
-- NE MODIFIE AUCUNE DONNÉE EXISTANTE. Ajoute une table et 5 portes.
-- =============================================================================
--
-- POURQUOI PAS DIRECT : le nombre d'unités du pack décide la quantité — donc le
-- stock ET les frais upsell du relevé. Un vendeur qui tape « 1 » pour un pack de 3
-- paierait moins de frais et fausserait le stock. Sa décision (11/11) : le vendeur
-- PROPOSE, un manager / admin APPROUVE ; rien ne relie un lead avant l'approbation.
--
--   · table propositions_sku : (source, SKU, produit, pack, qui, quand). Une seule
--     proposition par SKU et par boutique. Aucune écriture directe : les portes.
--   · proposer_sku(source, sku, produit, pack) : un VENDEUR, pour SA boutique et SON
--     produit ; refusé si le SKU existe déjà (validé) ou est déjà proposé.
--   · approuver_sku(proposition) : manager / admin (gere_la_config) ou super admin —
--     crée la correspondance par ajouter_correspondance_sku (sku_ecran.sql : les
--     leads qui attendent sont reliés tout de suite), puis efface la proposition.
--     Rend le nombre de leads reliés.
--   · refuser_sku(proposition) : le responsable, ou le vendeur qui la retire.
--   · skus_du_produit(produit) : les SKU validés d'un produit — le vendeur ne lit
--     pas la table des correspondances ; ici seulement ceux de SES produits.
--   · skus_inconnus_du_vendeur(entreprise) : les SKU reçus de SES boutiques sans
--     correspondance (pour qu'il sache quoi proposer).
--   Lecture des propositions : le vendeur les siennes, les responsables celles de
--   l'entreprise.
--
-- RETOUR ARRIÈRE : sku_propositions_retour.sql (copie sur le Bureau) — les
-- propositions en attente sont perdues ; les SKU déjà approuvés restent.
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.ajouter_correspondance_sku(uuid, text, uuid, integer)') is null then
    raise exception 'sku_propositions.sql : lancez d''abord sku_ecran.sql. Rien n''est installé.';
  end if;
end $$;

create table if not exists public.propositions_sku (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  source_id     uuid not null references public.sources_import(id) on delete cascade,
  sku           text not null check (btrim(sku) <> ''),
  produit_id    uuid not null references public.produits(id) on delete cascade,
  multiplicateur integer not null check (multiplicateur between 1 and 100),
  propose_par   uuid not null default auth.uid(),
  propose_le    timestamptz not null default now()
);
comment on table public.propositions_sku is 'fichier: sku_propositions.sql — SKU proposés par un vendeur, en attente d''un responsable.';
create unique index if not exists propositions_sku_une_par_sku on public.propositions_sku (source_id, lower(btrim(sku)));

alter table public.propositions_sku enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'propositions_sku'
  loop execute format('drop policy %I on public.propositions_sku', p.policyname); end loop;
end $$;
create policy propositions_sku_lecture on public.propositions_sku for select to authenticated
  using (public.is_super_admin()
         or (tenant_id = public.get_my_tenant_id() and (public.est_responsable() or propose_par = auth.uid())));
revoke all on public.propositions_sku from anon, authenticated;
grant select on public.propositions_sku to authenticated;
grant all on public.propositions_sku to service_role;

create or replace function public.proposer_sku(p_source uuid, p_sku text, p_produit uuid, p_multiplicateur integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_src public.sources_import%rowtype; v_prod public.produits%rowtype; v_sku text := btrim(coalesce(p_sku, '')); v_id uuid;
begin
  select * into v_src from public.sources_import where id = p_source;
  select * into v_prod from public.produits where id = p_produit;
  if v_src.id is null or v_prod.id is null then
    raise exception 'Boutique ou produit introuvable.';
  end if;
  if auth.uid() is null or v_src.vendeur_id is distinct from auth.uid() or v_prod.vendeur_id is distinct from auth.uid()
     or v_src.tenant_id <> v_prod.tenant_id then
    raise exception 'Vous proposez un SKU pour VOTRE boutique et VOTRE produit seulement.' using errcode = '42501';
  end if;
  if v_sku = '' then
    raise exception 'Écrivez le SKU exactement comme la boutique l''envoie.';
  end if;
  if p_multiplicateur is null or p_multiplicateur < 1 or p_multiplicateur > 100 then
    raise exception 'Le pack doit être un nombre d''unités entre 1 et 100.';
  end if;
  if exists (select 1 from public.correspondances_sku c where c.source_id = p_source and lower(btrim(c.sku)) = lower(v_sku)) then
    raise exception 'Le SKU « % » existe déjà pour cette boutique.', v_sku;
  end if;
  if exists (select 1 from public.propositions_sku x where x.source_id = p_source and lower(btrim(x.sku)) = lower(v_sku)) then
    raise exception 'Le SKU « % » est déjà proposé : il attend un responsable.', v_sku;
  end if;
  insert into public.propositions_sku (tenant_id, source_id, sku, produit_id, multiplicateur, propose_par)
  values (v_src.tenant_id, p_source, v_sku, p_produit, p_multiplicateur, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.proposer_sku(uuid, text, uuid, integer) from public, anon;
grant execute on function public.proposer_sku(uuid, text, uuid, integer) to authenticated, service_role;
comment on function public.proposer_sku(uuid, text, uuid, integer) is 'fichier: sku_propositions.sql';

create or replace function public.approuver_sku(p_proposition uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare x public.propositions_sku%rowtype; n integer;
begin
  select * into x from public.propositions_sku where id = p_proposition for update;
  if not found then
    raise exception 'Proposition introuvable (déjà traitée ?).';
  end if;
  if not (public.is_super_admin() or (x.tenant_id = public.get_my_tenant_id() and public.gere_la_config())) then
    raise exception 'Seul un manager ou un admin approuve un SKU.' using errcode = '42501';
  end if;
  -- la porte du responsable : mêmes contrôles, et les leads qui attendent sont reliés
  select r.commandes_reliees into n
    from public.ajouter_correspondance_sku(x.source_id, x.sku, x.produit_id, x.multiplicateur) r;
  delete from public.propositions_sku where id = x.id;
  return coalesce(n, 0);
end;
$$;
revoke all on function public.approuver_sku(uuid) from public, anon;
grant execute on function public.approuver_sku(uuid) to authenticated, service_role;
comment on function public.approuver_sku(uuid) is 'fichier: sku_propositions.sql';

create or replace function public.refuser_sku(p_proposition uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare x public.propositions_sku%rowtype;
begin
  select * into x from public.propositions_sku where id = p_proposition;
  if not found then
    raise exception 'Proposition introuvable (déjà traitée ?).';
  end if;
  if not (public.is_super_admin()
          or (x.tenant_id = public.get_my_tenant_id() and (public.gere_la_config() or x.propose_par = auth.uid()))) then
    raise exception 'Votre rôle ne permet pas de retirer cette proposition.' using errcode = '42501';
  end if;
  delete from public.propositions_sku where id = x.id;
end;
$$;
revoke all on function public.refuser_sku(uuid) from public, anon;
grant execute on function public.refuser_sku(uuid) to authenticated, service_role;
comment on function public.refuser_sku(uuid) is 'fichier: sku_propositions.sql';

create or replace function public.skus_du_produit(p_produit uuid)
returns table (id uuid, sku text, multiplicateur integer, source_id uuid, titre_vu text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_prod public.produits%rowtype;
begin
  select * into v_prod from public.produits p where p.id = p_produit;
  if v_prod.id is null
     or not (public.is_super_admin()
             or (v_prod.tenant_id = public.get_my_tenant_id()
                 and (public.est_responsable() or v_prod.vendeur_id = auth.uid()))) then
    raise exception 'Ce produit n''est pas à vous.' using errcode = '42501';
  end if;
  return query select c.id, c.sku, c.multiplicateur, c.source_id, c.titre_vu
                 from public.correspondances_sku c where c.produit_id = p_produit order by c.sku;
end;
$$;
revoke all on function public.skus_du_produit(uuid) from public, anon;
grant execute on function public.skus_du_produit(uuid) to authenticated, service_role;
comment on function public.skus_du_produit(uuid) is 'fichier: sku_propositions.sql';

create or replace function public.skus_inconnus_du_vendeur(p_tenant uuid)
returns table (source_id uuid, source_nom text, sku text, titre text, nb_commandes integer, dernier timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_tenant is distinct from public.get_my_tenant_id() then
    raise exception 'Cette entreprise n''est pas la vôtre.' using errcode = '42501';
  end if;
  return query
  select c.source_id, s.nom, btrim(c.articles -> 0 ->> 'code'),
         (array_agg(c.articles -> 0 ->> 'produit' order by c.created_at desc))[1],
         count(*)::integer, max(c.created_at)
    from public.commandes c
    join public.sources_import s on s.id = c.source_id and s.vendeur_id = auth.uid()
   where c.tenant_id = p_tenant and c.produit_id is null and c.multiplicateur_sku is null
     and jsonb_typeof(c.articles) = 'array' and jsonb_array_length(c.articles) = 1
     and nullif(btrim(c.articles -> 0 ->> 'code'), '') is not null
     and not exists (select 1 from public.correspondances_sku m
                      where m.source_id = c.source_id and lower(btrim(m.sku)) = lower(btrim(c.articles -> 0 ->> 'code')))
   group by c.source_id, s.nom, btrim(c.articles -> 0 ->> 'code')
   order by count(*) desc, max(c.created_at) desc;
end;
$$;
revoke all on function public.skus_inconnus_du_vendeur(uuid) from public, anon;
grant execute on function public.skus_inconnus_du_vendeur(uuid) to authenticated, service_role;
comment on function public.skus_inconnus_du_vendeur(uuid) is 'fichier: sku_propositions.sql';

do $$
begin
  if has_table_privilege('authenticated', 'public.propositions_sku', 'insert')
     or has_table_privilege('authenticated', 'public.propositions_sku', 'delete') then
    raise exception 'sku_propositions.sql : un compte écrit les propositions en direct. Rien n''est installé.';
  end if;
  raise notice 'sku_propositions.sql : le vendeur propose un SKU, un manager / admin l''approuve (les leads sont alors reliés). Aucune donnée modifiée.';
end $$;

commit;
