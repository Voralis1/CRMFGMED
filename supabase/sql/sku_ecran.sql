-- =============================================================================
-- LES SKU DE BOUTIQUE DEPUIS L'ÉCRAN — 11/11/2026 (T20)
-- NE MODIFIE AUCUNE DONNÉE À L'INSTALLATION. Ajoute 3 portes.
-- =============================================================================
--
-- SA DEMANDE : « créer un SKU pour relier un produit aux leads » sans SQL.
-- Jusqu'ici une correspondance SKU (correspondances_sku.sql) ne s'ajoutait
-- qu'en SQL (les 6 packs du 09/11) ; un SKU inconnu laissait ses leads en
-- « Produit non reconnu ».
--
--   · ajouter_correspondance_sku(source, sku, produit, pack) : manager / admin
--     (gere_la_config) de l'entreprise de la source, ou super admin. Le produit
--     doit être du vendeur de la source (trg_correspondances_sku_garde, inchangé).
--     Les leads de cette source qui ATTENDENT ce SKU (non reliés, jamais
--     multipliés, rien sorti du stock — la règle du rattrapage, fichier 2) sont
--     reliés tout de suite : produit, quantité × pack. Les règles de stock les
--     font passer « En attente » ou « Rupture » (commande_liberer_stock).
--     Rend le nombre de leads reliés.
--   · retirer_correspondance_sku(id) : mêmes droits ; REFUSE tant qu'une
--     commande est reliée par ce SKU (sa quantité a été multipliée par lui).
--   · skus_inconnus(entreprise) : les SKU reçus d'une boutique sans
--     correspondance, avec leur titre et le nombre de leads qui attendent —
--     lecture : responsables de l'entreprise, super admin.
--
-- RETOUR ARRIÈRE : sku_ecran_retour.sql (copie sur le Bureau) — retire les
-- portes ; les correspondances ajoutées restent (elles sont des données).
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.correspondances_sku') is null then
    raise exception 'sku_ecran.sql : lancez d''abord correspondances_sku.sql. Rien n''est installé.';
  end if;
  if to_regprocedure('public.gere_la_config()') is null then
    raise exception 'sku_ecran.sql : gere_la_config() absente. Rien n''est installé.';
  end if;
end $$;

create or replace function public.ajouter_correspondance_sku(p_source uuid, p_sku text, p_produit uuid, p_multiplicateur integer)
returns table (correspondance_id uuid, commandes_reliees integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.sources_import%rowtype;
  v_sku text := btrim(coalesce(p_sku, ''));
  v_id uuid;
  n integer;
begin
  select * into v_src from public.sources_import where id = p_source;
  if not found then
    raise exception 'Boutique (source) introuvable.';
  end if;
  if not (public.is_super_admin() or (v_src.tenant_id = public.get_my_tenant_id() and public.gere_la_config())) then
    raise exception 'Votre rôle ne permet pas de gérer les SKU.' using errcode = '42501';
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

  insert into public.correspondances_sku (tenant_id, source_id, sku, produit_id, multiplicateur, titre_vu)
  values (v_src.tenant_id, p_source, v_sku, p_produit, p_multiplicateur,
          (select c.articles -> 0 ->> 'produit' from public.commandes c
            where c.source_id = p_source and lower(btrim(c.articles -> 0 ->> 'code')) = lower(v_sku)
            order by c.created_at desc limit 1))
  returning id into v_id;

  -- les leads qui attendent ce SKU (règle du rattrapage, correspondances_sku_2_rattrapage.sql)
  perform set_config('crm.produit_rattrapage', 'oui', true);
  update public.commandes c
     set produit_id = p_produit,
         quantite = coalesce(c.quantite, 1) * p_multiplicateur,
         multiplicateur_sku = p_multiplicateur
   where c.tenant_id = v_src.tenant_id and c.source_id = p_source
     and c.produit_id is null and c.multiplicateur_sku is null and c.stock_ajuste is null
     and jsonb_typeof(c.articles) = 'array' and jsonb_array_length(c.articles) = 1
     and lower(btrim(c.articles -> 0 ->> 'code')) = lower(v_sku);
  get diagnostics n = row_count;
  perform set_config('crm.produit_rattrapage', '', true);

  return query select v_id, n;
end;
$$;
revoke all on function public.ajouter_correspondance_sku(uuid, text, uuid, integer) from public, anon;
grant execute on function public.ajouter_correspondance_sku(uuid, text, uuid, integer) to authenticated, service_role;
comment on function public.ajouter_correspondance_sku(uuid, text, uuid, integer) is 'fichier: sku_ecran.sql';

create or replace function public.retirer_correspondance_sku(p_correspondance uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare m public.correspondances_sku%rowtype; n integer;
begin
  select * into m from public.correspondances_sku where id = p_correspondance;
  if not found then
    raise exception 'SKU introuvable.';
  end if;
  if not (public.is_super_admin() or (m.tenant_id = public.get_my_tenant_id() and public.gere_la_config())) then
    raise exception 'Votre rôle ne permet pas de gérer les SKU.' using errcode = '42501';
  end if;
  select count(*) into n from public.commandes c
   where c.source_id = m.source_id and c.multiplicateur_sku is not null
     and lower(btrim(c.articles -> 0 ->> 'code')) = lower(btrim(m.sku));
  if n > 0 then
    raise exception 'Le SKU « % » relie déjà % commande(s) : il ne se retire pas.', m.sku, n;
  end if;
  delete from public.correspondances_sku where id = m.id;
end;
$$;
revoke all on function public.retirer_correspondance_sku(uuid) from public, anon;
grant execute on function public.retirer_correspondance_sku(uuid) to authenticated, service_role;
comment on function public.retirer_correspondance_sku(uuid) is 'fichier: sku_ecran.sql';

create or replace function public.skus_inconnus(p_tenant uuid)
returns table (source_id uuid, source_nom text, vendeur_id uuid, sku text, titre text, nb_commandes integer, dernier timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_super_admin() or (p_tenant = public.get_my_tenant_id() and public.est_responsable())) then
    raise exception 'Votre rôle ne permet pas de voir les SKU.' using errcode = '42501';
  end if;
  return query
  select c.source_id, s.nom, s.vendeur_id, btrim(c.articles -> 0 ->> 'code'),
         (array_agg(c.articles -> 0 ->> 'produit' order by c.created_at desc))[1],
         count(*)::integer, max(c.created_at)
    from public.commandes c
    join public.sources_import s on s.id = c.source_id
   where c.tenant_id = p_tenant and c.produit_id is null and c.multiplicateur_sku is null
     and jsonb_typeof(c.articles) = 'array' and jsonb_array_length(c.articles) = 1
     and nullif(btrim(c.articles -> 0 ->> 'code'), '') is not null
     and not exists (select 1 from public.correspondances_sku m
                      where m.source_id = c.source_id and lower(btrim(m.sku)) = lower(btrim(c.articles -> 0 ->> 'code')))
   group by c.source_id, s.nom, s.vendeur_id, btrim(c.articles -> 0 ->> 'code')
   order by count(*) desc, max(c.created_at) desc;
end;
$$;
revoke all on function public.skus_inconnus(uuid) from public, anon;
grant execute on function public.skus_inconnus(uuid) to authenticated, service_role;
comment on function public.skus_inconnus(uuid) is 'fichier: sku_ecran.sql';

do $$
begin
  if (select count(*) from pg_proc where proname in ('ajouter_correspondance_sku', 'retirer_correspondance_sku', 'skus_inconnus')) <> 3 then
    raise exception 'sku_ecran.sql : les 3 portes ne sont pas là. Rien n''est installé.';
  end if;
  raise notice 'sku_ecran.sql : SKU ajoutés / retirés depuis l''écran, leads en attente reliés tout de suite. Aucune donnée modifiée.';
end $$;

commit;
