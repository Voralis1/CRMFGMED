-- =============================================================================
-- UNE COMMANDE NE POINTE JAMAIS VERS LE PRODUIT D'UN AUTRE VENDEUR — 13/11/2026 (sa décision)
-- NE MODIFIE AUCUNE COMMANDE, AUCUN PRODUIT, AUCUNE CORRESPONDANCE. Ajoute 3 verrous.
-- =============================================================================
--
-- POURQUOI (lu en prod le 13/11) : MAN-MWATM2IQ-TQCT (entreprise de test, du 10/11,
-- avant T14) est la commande de « seller » reliée au « product c » de « seller1 ».
-- Depuis T14 (produits_par_vendeur.sql) le lien se CALCULE chez le vendeur de la
-- commande d'abord, et ne s'écrit pas à la main ; les correspondances SKU exigent
-- le produit du vendeur de la boutique (correspondances_sku_garde : 0 croisée sur 23).
-- Restaient deux portes, et aucun verrou sur la commande elle-même :
--   · changer le VENDEUR D'UN PRODUIT alors que des commandes d'un autre vendeur
--     (ou les SKU d'une boutique d'un autre vendeur) l'utilisent ;
--   · changer le VENDEUR D'UNE BOUTIQUE alors que ses SKU pointent vers les
--     produits de l'ancien vendeur (les leads suivants seraient croisés).
--
-- LES 3 VERROUS (la règle de 10/11 reste : un produit SANS vendeur sert à tous) :
--   1. commandes : si le produit relié a un vendeur et que ce n'est pas celui de la
--      commande, le lien est RETIRÉ (le lead devient « Produit non reconnu ») —
--      jamais une erreur : un lead de la boutique ou de l'API ne doit pas être perdu.
--   2. produits : changer son vendeur est REFUSÉ (message) tant que des commandes
--      d'un autre vendeur ou des SKU d'une boutique d'un autre vendeur l'utilisent.
--      Vendeur → vide (compte supprimé, ON DELETE SET NULL) : toujours permis.
--   3. sources_import : changer le vendeur d'une boutique est REFUSÉ tant que ses SKU
--      pointent vers des produits d'un autre vendeur. Vers vide : permis.
--   Les données existantes ne bougent pas (MAN-MWATM2IQ-TQCT : à supprimer par le
--   bouton, sa décision).
--
--   §1 prérequis ; §2 commandes ; §3 produits ; §4 boutiques ; §5 contrôles ;
--   §6 répétition (annulée) dans l'entreprise de test.
--
-- RETOUR ARRIÈRE : produit_meme_vendeur_retour.sql (copie sur le Bureau).
-- =============================================================================

begin;

-- §1 Prérequis ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.produit_de_commande_vendeur(uuid, text, uuid)') is null then
    raise exception 'produit_meme_vendeur.sql : lancez d''abord produits_par_vendeur.sql (T14). Rien n''est installé.';
  end if;
  if to_regclass('public.correspondances_sku') is null then
    raise exception 'produit_meme_vendeur.sql : lancez d''abord correspondances_sku.sql. Rien n''est installé.';
  end if;
end $$;

-- §2 La commande : jamais le produit d'un autre vendeur -----------------------------
-- Après trg_zz_produit_commande et trg_zz_produit_sku (ordre alphabétique :
-- « …_produit_sku » < « …_produit_vendeur »), avant trg_zzz_statut_stock (qui pose
-- « Produit non reconnu » à l'arrivée quand le lien est vide).
create or replace function public.commande_produit_meme_vendeur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_proprio uuid;
begin
  if new.produit_id is null or new.vendeur_id is null then
    return new;
  end if;
  select p.vendeur_id into v_proprio from public.produits p where p.id = new.produit_id;
  if v_proprio is not null and v_proprio <> new.vendeur_id then
    new.produit_id := null;
  end if;
  return new;
end;
$$;
revoke all on function public.commande_produit_meme_vendeur() from public, anon, authenticated;
comment on function public.commande_produit_meme_vendeur() is 'fichier: produit_meme_vendeur.sql';
drop trigger if exists trg_zz_produit_vendeur_garde on public.commandes;
create trigger trg_zz_produit_vendeur_garde
  before insert or update of produit_id, vendeur_id, produit, multiplicateur_sku on public.commandes
  for each row execute function public.commande_produit_meme_vendeur();

-- §3 Le produit : pas de changement de vendeur qui croiserait des commandes ou des SKU ----
create or replace function public.produit_vendeur_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n_cmd bigint; n_sku bigint;
begin
  if new.vendeur_id is not distinct from old.vendeur_id or new.vendeur_id is null then
    return new;
  end if;
  select count(*) into n_cmd from public.commandes c
   where c.produit_id = new.id and c.vendeur_id is not null and c.vendeur_id <> new.vendeur_id;
  select count(*) into n_sku from public.correspondances_sku m
    join public.sources_import s on s.id = m.source_id
   where m.produit_id = new.id and s.vendeur_id is distinct from new.vendeur_id;
  if n_cmd > 0 or n_sku > 0 then
    raise exception 'Le produit « % » ne change pas de vendeur : % commande(s) et % SKU de boutique d''un autre vendeur l''utilisent. Créez plutôt un produit pour le nouveau vendeur.',
      new.product, n_cmd, n_sku using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.produit_vendeur_change() from public, anon, authenticated;
comment on function public.produit_vendeur_change() is 'fichier: produit_meme_vendeur.sql';
drop trigger if exists trg_zz_produit_vendeur_change on public.produits;
create trigger trg_zz_produit_vendeur_change
  before update of vendeur_id on public.produits
  for each row execute function public.produit_vendeur_change();

-- §4 La boutique : pas de changement de vendeur qui croiserait ses SKU ------------------
create or replace function public.source_vendeur_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  if new.vendeur_id is not distinct from old.vendeur_id or new.vendeur_id is null then
    return new;
  end if;
  select count(*) into n from public.correspondances_sku m
    join public.produits p on p.id = m.produit_id
   where m.source_id = new.id and p.vendeur_id is distinct from new.vendeur_id;
  if n > 0 then
    raise exception 'La boutique « % » ne change pas de vendeur : % SKU pointent vers les produits de l''ancien vendeur. Retirez-les (Produits → SKU) ou créez les produits du nouveau vendeur d''abord.',
      new.nom, n using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.source_vendeur_change() from public, anon, authenticated;
comment on function public.source_vendeur_change() is 'fichier: produit_meme_vendeur.sql';
drop trigger if exists tr_sources_vendeur_sku on public.sources_import;
create trigger tr_sources_vendeur_sku
  before update of vendeur_id on public.sources_import
  for each row execute function public.source_vendeur_change();

-- §5 Contrôles ----------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_trigger where tgname in ('trg_zz_produit_vendeur_garde', 'trg_zz_produit_vendeur_change', 'tr_sources_vendeur_sku')
        and tgenabled <> 'D') <> 3 then
    raise exception 'produit_meme_vendeur.sql : les 3 verrous ne sont pas actifs. Rien n''est installé.';
  end if;
end $$;

-- §6 Répétition (annulée) : seller1 a un produit, sa commande y est reliée ;
--    changer le vendeur du produit est refusé ; la commande de « seller » forcée
--    vers ce produit perd le lien. Tout est annulé.
do $$
declare
  c_test constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  v_s1 uuid; v_s2 uuid; v_pays uuid; v_prod uuid; v_c1 uuid; v_c2 uuid; v_msg text; v_etape text := 'préparation'; v_refus boolean;
begin
  select u.user_id into v_s1 from public.user_roles u where u.tenant_id = c_test and lower(u.role) = 'seller' order by u.email limit 1;
  select u.user_id into v_s2 from public.user_roles u where u.tenant_id = c_test and lower(u.role) = 'seller' and u.user_id <> v_s1 order by u.email limit 1;
  select id into v_pays from public.pays where tenant_id = c_test and code = 'AO' limit 1;
  if v_s1 is null or v_s2 is null or v_pays is null then
    raise notice 'produit_meme_vendeur.sql : pas deux vendeurs et l''Angola dans l''entreprise de test — répétition sautée.'; return;
  end if;
  begin
    v_etape := 'un produit du vendeur 1, une commande du vendeur 1 reliée';
    insert into public.produits (tenant_id, product, code, price, vendeur_id)
    values (c_test, 'Répétition PMV', 'repetition-pmv', 1, v_s1) returning id into v_prod;
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, prix, pays_id, vendeur_id, ville_zone, adresse)
    values (c_test, 'REPETITION-PMV-1', 'R', '+244900000031', 'repetition-pmv', 0, v_pays, v_s1, 'Luanda', 'rue') returning id into v_c1;
    if (select produit_id from public.commandes where id = v_c1) is distinct from v_prod then
      raise exception 'la commande du vendeur 1 n''est pas reliée à son produit';
    end if;

    v_etape := 'changer le vendeur du produit : refusé';
    v_refus := false;
    begin update public.produits set vendeur_id = v_s2 where id = v_prod;
    exception when check_violation then v_refus := sqlerrm like '%ne change pas de vendeur%'; end;
    if not v_refus then raise exception 'le produit a changé de vendeur malgré la commande'; end if;

    v_etape := 'la commande du vendeur 2 forcée vers ce produit : le lien est retiré';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, prix, pays_id, vendeur_id, ville_zone, adresse)
    values (c_test, 'REPETITION-PMV-2', 'R', '+244900000032', 'autre chose', 0, v_pays, v_s2, 'Luanda', 'rue') returning id into v_c2;
    perform set_config('crm.produit_rattrapage', 'oui', true);
    update public.commandes set produit_id = v_prod where id = v_c2;
    perform set_config('crm.produit_rattrapage', '', true);
    if (select produit_id from public.commandes where id = v_c2) is not null then
      raise exception 'la commande d''un autre vendeur garde le lien';
    end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    perform set_config('crm.produit_rattrapage', '', true);
    if v_msg <> 'REPETITION_OK' then
      raise exception 'produit_meme_vendeur.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'produit_meme_vendeur.sql : une commande ne pointe plus jamais vers le produit d''un autre vendeur (3 verrous). Répétition annulée.';
end $$;

commit;

-- Ce qui est en place, et la seule commande croisée d'avant (à supprimer par le bouton)
select (select string_agg(tgname, ', ' order by tgname) from pg_trigger
         where tgname in ('trg_zz_produit_vendeur_garde', 'trg_zz_produit_vendeur_change', 'tr_sources_vendeur_sku')) as verrous,
       (select string_agg(c.lead_id, ', ') from public.commandes c join public.produits p on p.id = c.produit_id
         where c.vendeur_id is not null and p.vendeur_id is not null and p.vendeur_id <> c.vendeur_id) as commandes_croisees;
