-- =====================================================================
-- Le livreur d'une commande, par sa ZONE — 27/10/2026
-- Révisé le 27/10 (2) : le repli sans zone n'est plus « contient » mais
-- l'ÉGALITÉ du nom complet. Relancez CE fichier : c'est la seule
-- définition de livreur_pour_commande.
-- À lancer APRÈS zone_commande.sql (il utilise texte_normalise).
-- =====================================================================
--
-- LE PROBLÈME : choisir_livreur comparait des textes :
--
--     lower(ville_zone) like '%' || lower(livreurs.zone) || '%'
--
-- Un livreur de la zone « Ben » prenait « Benguela » ; « Anda », « Luanda ».
-- Toute zone au nom court avalait chaque ville qui contient ces lettres, et
-- la commande partait chez le mauvais livreur — dans le bon pays, donc rien
-- n'avait l'air faux. Une recherche de sous-chaîne à la place d'une
-- relation. (Lu en production le 27/10 : aucune zone dont le nom est contenu
-- dans celui d'une autre zone du même pays — 0 cas aujourd'hui. Le trou
-- s'ouvre à la première zone courte.)
--
-- LA RÈGLE :
--
--   · la commande a une zone (zone_id, d'une zone de son entreprise et de
--     son pays) : livreurs actifs du pays dont la zone porte CE nom, aux
--     accents/casse/espaces près (texte_normalise). Aucun livreur dans cette
--     zone → personne : la commande va dans « À assigner ». On ne retombe
--     PAS sur le texte : la zone est la vérité, le texte pourrait choisir un
--     livreur d'une autre zone.
--   · la commande n'a pas de zone (ou une zone incohérente : autre pays,
--     autre entreprise) : la ville doit ÊTRE le nom de la zone du livreur,
--     aux accents/casse/espaces près (texte_normalise). Plus jamais
--     « contient » (27/10, 2e version) : « Ben » prenait « Benguela ».
--     Pas de livreur vaut mieux qu'un mauvais : une commande sans livreur
--     attend, visible, dans « À assigner », et quelqu'un l'assigne en une
--     minute ; une commande chez le mauvais livreur a l'air faite, et on
--     l'apprend quand la marchandise est dans la mauvaise ville.
--     Mesuré le 27/10 : 4 commandes ouvertes de Fgmed Angola perdent leur
--     livreur (des villes écrites « Luanda Angola », « Cidade de Luanda »…),
--     elles iront dans « À assigner ».
--   · le reste ne change pas : même pays, actif, avec un compte, le moins
--     chargé (a_preparer + expedie), puis au hasard.
--
-- livreurs.zone est un TEXTE (le nom d'une zone, vérifié à l'écriture par
-- check_livreur_pays). On compare donc des noms normalisés, pas des ids.
--
-- UN SEUL CORPS : livreur_pour_commande(). choisir_livreur garde sa
-- signature (rien d'autre ne casse) et lui délègue, sans zone.
-- auto_affecter_livreur passe la zone de la commande.
--
-- ⚠ NE PAS RELANCER correctif_urgent_14_10.sql : il remet un
-- auto_affecter_livreur qui ne passe pas la zone (retour silencieux au
-- texte). Si c'est fait, relancer CE fichier. nettoyage_triggers_14_10.sql
-- remet l'ancien corps de choisir_livreur (même comportement que le repli
-- d'ici) : sans danger, mais relancer ce fichier ensuite.
--
-- Ne modifie aucune ligne. Exécutable en entier, et deux fois.
-- =====================================================================

do $$
begin
  -- Ce que zone_commande.sql crée lui-même : zone_de_commande. Pas
  -- texte_normalise, qui vient d'entrepot_commande.sql depuis le 29/10 et
  -- ne prouve donc plus que zone_commande.sql est passé.
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'zone_de_commande') then
    raise exception 'Lancez d''abord zone_commande.sql : zone_de_commande() n''existe pas.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1. Le choix
-- ---------------------------------------------------------------------
create or replace function public.livreur_pour_commande(
  p_tenant  uuid,
  p_pays    uuid,
  p_zone    uuid,
  p_ville   text,
  p_exclure uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with zone_commande as (
    -- La zone ne compte que si elle est de cette entreprise et de ce pays.
    select public.texte_normalise(z.nom_zone) as nom
      from public.zones z
     where z.id = p_zone and z.tenant_id = p_tenant and z.pays_id = p_pays
  )
  select l.id
    from public.livreurs l
   where l.tenant_id = p_tenant
     and l.pays_id = p_pays
     and l.actif = true
     and l.user_id is not null
     and (p_exclure is null or l.id <> p_exclure)
     and l.zone is not null and btrim(l.zone) <> ''
     and case
           when exists (select 1 from zone_commande) then
             -- par la zone : égalité de noms, jamais « contient »
             public.texte_normalise(l.zone) = (select nom from zone_commande)
           else
             -- repli, sans zone : la ville EST la zone du livreur, ou rien
             public.texte_normalise(l.zone) = public.texte_normalise(p_ville)
         end
   order by
     (select count(*) from public.livraisons v
       where v.livreur_id = l.id and v.statut in ('a_preparer', 'expedie')),
     random()
   limit 1
$$;

revoke all on function public.livreur_pour_commande(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. choisir_livreur : même signature, délègue (sans zone)
-- ---------------------------------------------------------------------
-- Ses droits actuels sont gardés (create or replace ne les touche pas).
create or replace function public.choisir_livreur(
  p_tenant  uuid,
  p_pays    uuid,
  p_ville   text,
  p_exclure uuid default null::uuid
)
returns uuid
language sql
security definer
set search_path to 'public'
as $$
  select public.livreur_pour_commande(p_tenant, p_pays, null, p_ville, p_exclure);
$$;
-- Marque (02/11) : ce fichier définit choisir_livreur. Les fichiers plus anciens qui
-- en ont une copie la lisent et ne la réécrivent plus.
comment on function public.choisir_livreur(uuid, uuid, text, uuid) is 'fichier: livreur_par_zone.sql';


-- ---------------------------------------------------------------------
-- 3. L'affectation automatique passe la zone
-- ---------------------------------------------------------------------
-- Corps de production du 27/10, une seule ligne change : l'appel.
create or replace function public.auto_affecter_livreur()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_livreur uuid;
  v_declenche boolean;
begin
  if new.statut_confirmation is null then return new; end if;

  if tg_op = 'UPDATE'
     and new.statut_confirmation is not distinct from old.statut_confirmation then
    return new;
  end if;

  select coalesce(bool_or(s.declenche_assignation), false) into v_declenche
  from public.statuts s
  where s.tenant_id = new.tenant_id
    and (s.nom = new.statut_confirmation or s.code = new.statut_confirmation)
    and (s.pays_id is null or s.pays_id = new.pays_id);

  if not v_declenche then return new; end if;

  if exists (select 1 from public.livraisons v where v.commande_id = new.id) then
    return new;
  end if;

  v_livreur := public.livreur_pour_commande(new.tenant_id, new.pays_id, new.zone_id, new.ville_zone);

  if v_livreur is not null then
    insert into public.livraisons (commande_id, livreur_id, tenant_id, statut)
    values (new.id, v_livreur, new.tenant_id, 'a_preparer');
  end if;

  return new;
end;
$$;
-- Marque (02/11) : ce fichier définit auto_affecter_livreur. Les fichiers plus anciens qui
-- en ont une copie la lisent et ne la réécrivent plus.
comment on function public.auto_affecter_livreur() is 'fichier: livreur_par_zone.sql';


-- ---------------------------------------------------------------------
-- 4. Vérification — lève une erreur si quelque chose manque
-- ---------------------------------------------------------------------
do $$
declare
  v_role text;
begin
  if position('livreur_pour_commande' in pg_get_functiondef('public.auto_affecter_livreur()'::regprocedure)) = 0 then
    raise exception 'auto_affecter_livreur n''appelle pas livreur_pour_commande.';
  end if;
  if position('like' in lower(pg_get_functiondef('public.livreur_pour_commande(uuid,uuid,uuid,text,uuid)'::regprocedure))) > 0 then
    raise exception 'livreur_pour_commande compare encore par « contient » (like).';
  end if;
  if position('livreur_pour_commande' in pg_get_functiondef('public.choisir_livreur(uuid,uuid,text,uuid)'::regprocedure)) = 0 then
    raise exception 'choisir_livreur ne délègue pas à livreur_pour_commande.';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.commandes'::regclass
                    and tgname = 'tr_auto_affecter_livreur' and tgenabled <> 'D') then
    raise exception 'tr_auto_affecter_livreur absent ou désactivé.';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.livreur_pour_commande(uuid,uuid,uuid,text,uuid)', 'execute') then
      raise exception 'livreur_pour_commande est encore exécutable par %.', v_role;
    end if;
  end loop;
  raise notice 'livreur_par_zone.sql : en place. Aucune ligne modifiée.';
end $$;
