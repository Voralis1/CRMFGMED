-- =============================================================================
-- lead_id : unique PAR ENTREPRISE, et préfixé par la source — 16/10/2026
-- À exécuter AVANT de déployer import-commande (la fonction lit
-- sources_import.prefixe_lead). Indépendant de intake_generique.sql.
-- Rejouable : on peut exécuter tout le fichier plusieurs fois sans risque.
--
-- LE PROBLÈME, en deux moitiés
--
--   commandes_lead_id_key était `unique (lead_id)` — pour le MONDE entier.
--   Les numéros de commande WooCommerce sont petits et séquentiels (727) :
--
--   1. deux vendeurs de deux ENTREPRISES envoient 727 : le second insert
--      échoue, 400, WooCommerce ré-essaie jusqu'à désactiver le webhook.
--      → corrigé par `unique (tenant_id, lead_id)` (§1).
--
--   2. deux boutiques de la MÊME entreprise envoient 727 : le second est pris
--      pour un doublon du premier et PERDU sans bruit. `unique (tenant_id,
--      lead_id)` seul n'y change rien.
--      → corrigé à l'entrée : chaque source a un préfixe court, et l'intake
--        range "SHOP1-727" (§2, et cleExterne() dans _shared/import.ts).
--
-- POURQUOI PAS `unique (tenant_id, source_id, lead_id)` : source_id est NULL
-- pour la saisie manuelle et l'import Excel, et deux NULL ne se heurtent pas
-- dans un index unique — deux commandes saisies avec le même lead_id
-- passeraient toutes les deux. Le préfixe, en plus, dit à l'agent d'où vient
-- la commande sans rien chercher.
--
-- CE FICHIER NE PEUT PAS ÉCHOUER SUR LES DONNÉES EXISTANTES : `unique
-- (lead_id)` est PLUS STRICT que `unique (tenant_id, lead_id)` ; tout ce qui
-- est unique dans le monde l'est déjà dans chaque entreprise. Vérifié en
-- production le 16/10 : 37 commandes, 35 lead_id hors AUTO-, 0 doublon par
-- entreprise. Le §0 le revérifie quand même avant de toucher à quoi que ce soit.
--
-- Les commandes existantes gardent leur lead_id : rien n'est renommé. Seuls
-- les leads qui arrivent par une source APRÈS le déploiement sont préfixés.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Avant tout : l'état des lead_id (le même compte est ré-affiché au §3)
-- -----------------------------------------------------------------------------
do $$
declare v_total int; v_hors_auto int; v_doublons int;
begin
  select count(*), count(*) filter (where lead_id not like 'AUTO-%')
    into v_total, v_hors_auto from public.commandes;
  select count(*) into v_doublons
    from (select 1 from public.commandes group by tenant_id, lead_id having count(*) > 1) d;
  raise notice 'commandes : %, lead_id hors AUTO- : %, doublons par entreprise : %',
    v_total, v_hors_auto, v_doublons;
  -- Impossible tant que l'ancienne contrainte tient — mais si elle a déjà été
  -- retirée à la main, on s'arrête ici plutôt qu'au milieu.
  -- 27/10 : depuis lead_id_par_vendeur_source.sql, deux vendeurs (ou deux
  -- sources) PEUVENT partager un numéro dans une entreprise. Ce n'est plus
  -- une anomalie, et le §1 ne touche plus à l'unicité : pas d'arrêt.
  if v_doublons > 0 and to_regclass('public.commandes_lead_id_vendeur_source_key') is null then
    raise exception '% lead_id en double dans une même entreprise : rien n''a été modifié', v_doublons;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 1. La contrainte : la nouvelle D'ABORD, l'ancienne ENSUITE
--
-- Dans cet ordre, la table n'est jamais sans protection, même une seconde.
-- Une contrainte du même nom sur d'autres colonnes est remplacée, pas gardée
-- en silence (§6.12).
--
-- idx_commandes_lead_id (btree simple sur lead_id) reste : il sert les
-- recherches par lead_id seul.
-- -----------------------------------------------------------------------------
do $$
declare v_def text;
begin
  -- 27/10 : la règle est devenue (entreprise, vendeur, source, lead_id)
  -- (lead_id_par_vendeur_source.sql). Relancer ce fichier ne doit pas
  -- remettre l'ancienne, plus stricte : on ne touche plus à rien ici.
  if to_regclass('public.commandes_lead_id_vendeur_source_key') is not null then
    raise notice '§1 sauté : lead_id_par_vendeur_source.sql est en place (unicité par entreprise + vendeur + source).';
    return;
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.commandes'::regclass and conname = 'commandes_tenant_lead_id_key';
  if v_def is not null and v_def <> 'UNIQUE (tenant_id, lead_id)' then
    alter table public.commandes drop constraint commandes_tenant_lead_id_key;
    v_def := null;
  end if;
  if v_def is null then
    alter table public.commandes
      add constraint commandes_tenant_lead_id_key unique (tenant_id, lead_id);
  end if;
end $$;

alter table public.commandes drop constraint if exists commandes_lead_id_key;


-- -----------------------------------------------------------------------------
-- 2. Le préfixe de la source : sources_import.prefixe_lead
--
--   - 1 à 12 caractères A-Z 0-9, unique dans l'entreprise ;
--   - tiré du nom de la source s'il n'est pas donné ("Boutique Dakar" →
--     "BOUTIQUE", puis "BOUTIQUE2" si le premier est pris) : la création
--     d'une source par creer_source_import() n'a rien à changer ;
--   - FIGÉ dès qu'une commande cite la source. Changer le préfixe changerait
--     la clé des commandes déjà reçues : le ré-essai d'une boutique créerait
--     alors un doublon.
-- -----------------------------------------------------------------------------
alter table public.sources_import add column if not exists prefixe_lead text;

create or replace function public.sources_prefixe_lead()
  returns trigger
  language plpgsql
  -- SECURITY DEFINER : un vendeur ne voit (RLS) que SES sources ; sans ce
  -- droit, il ne verrait pas qu'un autre a déjà pris le préfixe et la
  -- création échouerait sur l'index unique au lieu de prendre "…2".
  security definer
  set search_path to 'public'
  as $function$
declare
  v_base text;
  v_essai text;
  v_n int := 1;
begin
  -- Préfixe inchangé et déjà posé : rien à faire. Encore null : on le tire
  -- (c'est ainsi que le §2 remplit les sources existantes).
  if tg_op = 'UPDATE' and new.prefixe_lead is not distinct from old.prefixe_lead
     and new.prefixe_lead is not null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.prefixe_lead is not null and auth.uid() is not null
     and exists (select 1 from public.commandes c where c.source_id = old.id) then
    raise exception 'Le préfixe "%" est figé : des commandes de cette source le portent déjà', old.prefixe_lead
      using errcode = '42501';
  end if;

  if coalesce(btrim(new.prefixe_lead), '') <> '' then
    new.prefixe_lead := upper(btrim(new.prefixe_lead));
    return new; -- le format et l'unicité sont vérifiés par la contrainte et l'index
  end if;

  v_base := upper(regexp_replace(
    translate(coalesce(new.nom, ''),
              'àâäáãåéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ',
              'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN'),
    '[^A-Za-z0-9]', '', 'g'));
  v_base := left(coalesce(nullif(v_base, ''), 'SRC'), 10);
  v_essai := v_base;
  while exists (select 1 from public.sources_import s
                 where s.tenant_id = new.tenant_id and s.prefixe_lead = v_essai
                   and s.id is distinct from new.id) loop
    v_n := v_n + 1;
    v_essai := v_base || v_n;
  end loop;
  new.prefixe_lead := v_essai;
  return new;
end;
$function$;

revoke all on function public.sources_prefixe_lead() from public, anon, authenticated;

drop trigger if exists tr_sources_prefixe_lead on public.sources_import;
create trigger tr_sources_prefixe_lead
  before insert or update on public.sources_import
  for each row execute function public.sources_prefixe_lead();

-- Les sources existantes reçoivent leur préfixe, UNE PAR UNE : chaque ligne
-- voit le préfixe pris par la précédente.
do $$
declare r record;
begin
  for r in select id from public.sources_import where prefixe_lead is null order by created_at loop
    update public.sources_import set prefixe_lead = null where id = r.id;
  end loop;
end $$;

alter table public.sources_import alter column prefixe_lead set not null;

alter table public.sources_import drop constraint if exists sources_import_prefixe_lead_valide;
alter table public.sources_import
  add constraint sources_import_prefixe_lead_valide
  check (prefixe_lead ~ '^[A-Z0-9]{1,12}$');

drop index if exists public.idx_sources_import_prefixe_lead;
create unique index idx_sources_import_prefixe_lead
  on public.sources_import (tenant_id, prefixe_lead);

comment on column public.sources_import.prefixe_lead is
  'Préfixe des lead_id reçus par cette source (SHOP1-727). Unique par entreprise, figé dès la première commande.';


-- -----------------------------------------------------------------------------
-- 3. Vérification (lecture seule)
-- -----------------------------------------------------------------------------
select 'contrainte commandes' as quoi,
       string_agg(conname || ' ' || pg_get_constraintdef(oid), ' ; ') as etat
  from pg_constraint
 where conrelid = 'public.commandes'::regclass and conname like 'commandes_%lead_id_key'
union all
select 'lead_id hors AUTO-', count(*)::text from public.commandes where lead_id not like 'AUTO-%'
union all
select 'sources : préfixes', string_agg(nom || ' → ' || prefixe_lead, ' ; ' order by created_at)
  from public.sources_import;
