-- =============================================================================
-- Le produit d'une commande : commandes.produit_id — 29/10/2026
-- =============================================================================
--
-- LE TROU : une commande ne porte son produit qu'en TEXTE, tel qu'il est
-- arrivé (« product-c », « Product-a », « potencia »…). Le stock passait déjà
-- par produit_de_commande (code, puis nom, sans accents ni casse) ; mais les
-- filtres (Commandes, Centre d'appel) et le Dashboard « Top Produits »
-- groupaient par TEXTE : un produit écrit de deux façons comptait pour deux,
-- chaque moitié sous-comptée. Lu le 29/10 : Fgmed Angola avait « kneehuile »
-- (absent du catalogue) en tête du Top Produits ; regroupé, le vrai haut est
-- Clearzal 12, Colon Tea 11.
--
-- LA RÈGLE (sa décision, à ne pas casser) :
--   · commandes.produit (le TEXTE) n'est JAMAIS réécrit : il reste tel qu'il
--     est arrivé. produit_id est un AJOUT, pas une correction ;
--   · produit_id = produit_de_commande(entreprise, texte) — LA règle du stock,
--     la même partout ; posé par la base à l'insertion et quand le texte
--     change ; personne ne l'écrit à la main ;
--   · un produit renommé GARDE ses commandes (le lien ne se recalcule pas) ;
--     un produit supprimé les envoie dans « Produit non reconnu » (SET NULL) ;
--   · le rattrapage (remplir_produits_commandes) ne remplit QUE les liens
--     vides : il ne détache jamais une commande déjà reliée. Le relancer
--     après avoir créé un produit (ex. « kneehuile », 12 commandes réelles en
--     attente de la réponse du propriétaire) rattache ce qui y répond.
--
-- AUSSI dans ce fichier (son « fold » du 29/10) : produit_de_commande appelle
-- texte_normalise au lieu de recopier l'expression (même réponse : §3 le
-- PROUVE sur toutes les commandes et tout le catalogue avant de continuer).
-- La même fonction est dans entrepot_commande.sql (texte identique, vérifié
-- par test) : relancer ce fichier-là ne la remet pas en arrière.
--
-- CE QUE FAIT CE FICHIER :
--   §1  prérequis ;
--   §2  photo des réponses de produit_de_commande AVANT ;
--   §3  produit_de_commande appelle texte_normalise ; réponses comparées à la
--       photo — une seule différence et rien n'est installé ;
--   §4  commandes.produit_id (FK SET NULL) + index ;
--   §5  le trigger (pose le lien, refuse qu'on l'écrive à la main, laisse
--       passer le SET NULL d'un produit supprimé) ;
--   §6  remplir_produits_commandes() — et son appel (SEULE écriture sur des
--       commandes existantes : produit_id, rien d'autre) ;
--   §7  stats_dashboard : « Top Produits » par produit (corps de production,
--       ce seul bloc changé) ;
--   §8  vérification ; §9 répétition (de vraies écritures, annulées).
-- Retour arrière : commandes_produit_id_retour.sql
-- (copie : ~/Desktop/RETOUR_commandes_produit_id.sql).
-- Exécutable en entier, et deux fois.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Prérequis
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.produit_de_commande(uuid, text)') is null then
    raise exception 'produit_de_commande absent : entrepot_commande.sql doit être en place. Rien n''a été installé.';
  end if;
  if to_regprocedure('public.texte_normalise(text)') is null then
    raise exception 'texte_normalise absent. Rien n''a été installé.';
  end if;
  if to_regprocedure('public.stats_dashboard(uuid, timestamptz, timestamptz)') is null then
    raise exception 'stats_dashboard absent. Rien n''a été installé.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Photo des réponses AVANT (toutes les commandes, tout le catalogue, et
--    leurs variantes : majuscules, espaces, accents ajoutés)
-- -----------------------------------------------------------------------------
drop table if exists pg_temp.produit_avant;
create temp table produit_avant as
with textes as (
  select tenant_id, produit as texte from public.commandes
  union select tenant_id, code from public.produits where code is not null
  union select tenant_id, product from public.produits
  union select tenant_id, upper(code) from public.produits where code is not null
  union select tenant_id, '  ' || upper(product) || '  ' from public.produits
  union select tenant_id, translate(product, 'aeiouc', 'àéîõüç') from public.produits
  union select tenant_id, replace(product, ' ', '   ') from public.produits
)
select t.tenant_id, t.texte, r.produit_id, r.cas
  from textes t cross join lateral public.produit_de_commande(t.tenant_id, t.texte) r;


-- -----------------------------------------------------------------------------
-- 3. produit_de_commande appelle texte_normalise (même texte que
--    entrepot_commande.sql)
-- -----------------------------------------------------------------------------
create or replace function public.produit_de_commande(p_tenant uuid, p_produit text)
returns table (produit_id uuid, cas text, raison text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_texte   text := btrim(coalesce(p_produit, ''));
  v_nom     text;
  v_produit uuid;
  v_combien integer;
begin
  if v_texte = '' then
    return query select null::uuid, 'sans_produit'::text,
      'La commande ne porte aucun nom de produit.'::text;
    return;
  end if;

  -- texte_normalise : LA normalisation (29/10, plus d'expression recopiée ici).
  -- v_texte n'est pas vide : son nom normalisé non plus.
  v_nom := public.texte_normalise(v_texte);

  select count(*), min(p.id::text)::uuid into v_combien, v_produit
    from public.produits p
   where p.tenant_id = p_tenant
     and p.code is not null and btrim(p.code) <> ''
     and public.texte_normalise(p.code) = v_nom;
  if v_combien = 1 then
    return query select v_produit, 'trouve'::text, null::text;
    return;
  elsif v_combien > 1 then
    return query select null::uuid, 'produit_ambigu'::text,
      (v_combien || ' produits portent le code « ' || v_texte
        || ' » (aux accents près) : impossible de savoir lequel décompter.')::text;
    return;
  end if;

  select count(*), min(p.id::text)::uuid into v_combien, v_produit
    from public.produits p
   where p.tenant_id = p_tenant
     and public.texte_normalise(p.product) = v_nom;

  if v_combien = 1 then
    return query select v_produit, 'trouve'::text, null::text;
  elsif v_combien = 0 then
    return query select null::uuid, 'produit_inconnu'::text,
      ('Produit « ' || v_texte || ' » introuvable au catalogue.')::text;
  else
    return query select null::uuid, 'produit_ambigu'::text,
      (v_combien || ' produits portent le nom « ' || v_texte
        || ' » : impossible de savoir lequel décompter.')::text;
  end if;
end;
$$;

revoke all on function public.produit_de_commande(uuid, text) from public, anon, authenticated;

do $$
declare v_n integer; v_ex text;
begin
  select count(*), min(a.texte) into v_n, v_ex
    from pg_temp.produit_avant a
    cross join lateral public.produit_de_commande(a.tenant_id, a.texte) r
   where r.produit_id is distinct from a.produit_id or r.cas is distinct from a.cas;
  if v_n > 0 then
    raise exception 'produit_de_commande avec texte_normalise ne répond pas comme avant pour % texte(s) (ex. « % »). Rien n''a été installé.', v_n, v_ex;
  end if;
  raise notice 'produit_de_commande : % texte(s) comparés, réponses identiques.', (select count(*) from pg_temp.produit_avant);
end $$;
drop table if exists pg_temp.produit_avant;


-- -----------------------------------------------------------------------------
-- 4. La colonne
-- -----------------------------------------------------------------------------
alter table public.commandes add column if not exists produit_id uuid
  references public.produits(id) on delete set null;
create index if not exists idx_commandes_produit_id on public.commandes (tenant_id, produit_id);


-- -----------------------------------------------------------------------------
-- 5. Le trigger
-- -----------------------------------------------------------------------------
-- Ne touche JAMAIS new.produit. Pose produit_id :
--   · à l'insertion, et quand le texte ou l'entreprise changent : la réponse
--     de produit_de_commande (un id envoyé par l'appelant est ignoré) ;
--   · produit_id seul, écrit par quelqu'un : refusé — il se déduit du texte ;
--   · produit_id → NULL parce que le produit vient d'être supprimé (ON DELETE
--     SET NULL) : accepté, rien d'autre ne bouge ;
--   · le rattrapage (réglage local crm.produit_rattrapage) : accepté.
-- SECURITY DEFINER : la réponse ne dépend pas de ce que l'auteur voit du
-- catalogue (le vendeur ne voit que ses produits ; le stock non plus n'en
-- dépend pas).
-- GARDE (10/11) : commande_produit_id et son trigger sont repris par
-- produits_par_vendeur.sql (T14 : le produit se cherche chez le vendeur de la
-- commande). Marqués par lui → gardés tels quels, avec un avis.
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.commande_produit_id()'), 'pg_proc');
begin
  if v_marque in ('fichier: produits_par_vendeur.sql') then
    raise notice 'commandes_produit_id.sql : commande_produit_id gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.commande_produit_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.produit is distinct from old.produit
     or new.tenant_id is distinct from old.tenant_id then
    select r.produit_id into new.produit_id
      from public.produit_de_commande(new.tenant_id, new.produit) r;
    return new;
  end if;

  if new.produit_id is not distinct from old.produit_id then
    return new;
  end if;
  if coalesce(current_setting('crm.produit_rattrapage', true), '') = 'oui' then
    return new;
  end if;
  if new.produit_id is null
     and not exists (select 1 from public.produits where id = old.produit_id) then
    return new; -- le produit vient d'être supprimé : la commande passe en « non reconnu »
  end if;
  raise exception 'Le produit d''une commande se déduit de son texte (« % ») : produit_id ne s''écrit pas à la main.', new.produit;
end;
$$
$def$;
  execute $def$ revoke all on function public.commande_produit_id() from public, anon, authenticated $def$;
  execute $def$ create or replace trigger trg_zz_produit_commande
  before insert or update of produit, produit_id, tenant_id on public.commandes
  for each row execute function public.commande_produit_id() $def$;
end $garde$;


-- -----------------------------------------------------------------------------
-- 6. Le rattrapage : ne remplit QUE les liens vides (rejouable)
-- -----------------------------------------------------------------------------
-- GARDE (10/11) : reprise par produits_par_vendeur.sql (la règle par vendeur).
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.remplir_produits_commandes()'), 'pg_proc');
begin
  if v_marque in ('fichier: produits_par_vendeur.sql') then
    raise notice 'commandes_produit_id.sql : remplir_produits_commandes gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.remplir_produits_commandes()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n integer;
begin
  perform set_config('crm.produit_rattrapage', 'oui', true);
  update public.commandes c
     set produit_id = r.produit_id
    from (select c2.id, x.produit_id
            from public.commandes c2
            cross join lateral public.produit_de_commande(c2.tenant_id, c2.produit) x
           where c2.produit_id is null) r
   where c.id = r.id and r.produit_id is not null;
  get diagnostics v_n = row_count;
  perform set_config('crm.produit_rattrapage', '', true);
  return v_n;
end;
$$
$def$;
  execute $def$ revoke all on function public.remplir_produits_commandes() from public, anon, authenticated $def$;
end $garde$;

do $$
declare v_n integer;
begin
  v_n := public.remplir_produits_commandes();
  raise notice 'commandes_produit_id.sql : % commande(s) reliée(s) à leur produit (produit_id seulement, le texte n''est pas touché).', v_n;
end $$;


-- -----------------------------------------------------------------------------
-- 7. stats_dashboard : le corps de production (lu le 29/10, md5
--    ad8a7de2cb734f63bc32ddee2b69d377), le bloc « topProduits » seul changé
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stats_dashboard(p_tenant uuid, p_debut timestamp with time zone, p_fin timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  resultat jsonb;
begin
  return (
    with st as (
      select s.nom, s.code,
             coalesce(s.declenche_assignation, false) as confirme,
             coalesce(s.necessite_rappel, false)      as rappel
      from public.statuts s
      where s.tenant_id = p_tenant
    ),
    cmd as (
      select c.*,
             coalesce(c.created_at, c.date_commande::timestamptz) as moment
      from public.commandes c
      where c.tenant_id = p_tenant
    ),
    cmd_periode as (
      select * from cmd where moment >= p_debut and moment <= p_fin
    ),
    classe as (
      select c.*,
        case
          -- 27/10 : « Pending » est un vrai statut ; NULL reste lu tant que le
          -- rattrapage (statut_pending_2_rattrapage.sql) n'est pas passé.
          when c.statut_confirmation is null or c.statut_confirmation = 'Pending' then 'en_attente'
          when exists (select 1 from st
                       where (st.nom = c.statut_confirmation or st.code = c.statut_confirmation)
                         and st.confirme) then 'confirmee'
          when exists (select 1 from st
                       where (st.nom = c.statut_confirmation or st.code = c.statut_confirmation)
                         and st.rappel) then 'rappel'
          when c.statut_confirmation ~* '(annul|cancel)'            then 'annulee'
          when c.statut_confirmation ~* '(injoign|unreach|unrech)'  then 'injoignable'
          else 'autre'
        end as classe
      from cmd_periode c
    ),
    liv as (
      select v.*,
        case
          when lower(coalesce(v.statut, 'en_attente')) in ('livre', 'livree', 'livrée') then 'livre'
          when lower(coalesce(v.statut, 'en_attente')) ~ 'expedi'                       then 'en_attente'
          else lower(coalesce(v.statut, 'en_attente'))
        end as statut_propre
      from public.livraisons v
      where v.tenant_id = p_tenant
        and v.created_at >= p_debut and v.created_at <= p_fin
    ),
    -- un appel par commande : sinon un agent qui rappelle 3 fois compte 3 fois
    appel_cmd as (
      select distinct on (a.commande_id) a.commande_id, a.agent_id
      from public.appels a
      where a.tenant_id = p_tenant
        and a.created_at >= p_debut and a.created_at <= p_fin
      order by a.commande_id, a.created_at
    ),
    nb_appels as (
      select a.agent_id, count(*)::int as appels
      from public.appels a
      where a.tenant_id = p_tenant
        and a.created_at >= p_debut and a.created_at <= p_fin
      group by a.agent_id
    ),
    par_agent as (
      select
        ac.agent_id,
        count(*) filter (where cl.classe = 'confirmee')   ::int as confirmees,
        count(*) filter (where cl.classe = 'injoignable') ::int as injoignables,
        count(*) filter (where cl.classe = 'annulee')     ::int as annulees,
        count(*) filter (where cl.classe = 'rappel')      ::int as reprogrammees,
        count(*) filter (where cl.id in (select commande_id from liv where statut_propre = 'livre'))::int as livrees
      from appel_cmd ac
      join classe cl on cl.id = ac.commande_id
      group by ac.agent_id
    )
    select jsonb_build_object(

      'kpis', jsonb_build_object(
        'commandesTotal', (select count(*) from cmd_periode),
        'commandesJour',  (select count(*) from cmd
                           where moment >= date_trunc('day', now())),
        'tauxConfirmation', coalesce(round(
            100.0 * (select count(*) from classe where classe = 'confirmee')
                  / nullif((select count(*) from classe), 0), 1), 0),
        'tauxLivraison', coalesce(round(
            100.0 * (select count(*) from liv where statut_propre = 'livre')
                  / nullif((select count(*) from liv), 0), 1), 0)
      ),

      'caEncaisseListe', coalesce((
        select jsonb_agg(x order by x->>'total' desc)
        from (
          select jsonb_build_object(
                   'devise', coalesce(pa.devise, 'N/A'),
                   'total',  sum(p.montant)
                 ) as x
          from public.paiements p
          left join public.commandes c on c.id = p.commande_id
          left join public.pays pa     on pa.id = c.pays_id
          where p.tenant_id = p_tenant
            and p.statut in ('en_attente', 'encaisse', 'remis')
            and p.created_at >= p_debut and p.created_at <= p_fin
          group by coalesce(pa.devise, 'N/A')
        ) s
      ), '[]'::jsonb),

      'confirmationParHeure', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'heure', h,
                 'confirmees', coalesce(c.nb_conf, 0),
                 'annulees',   coalesce(c.nb_ann, 0)) order by h)
        from generate_series(0, 23) as h
        left join (
          select extract(hour from coalesce(updated_at, moment))::int as heure,
                 count(*) filter (where classe = 'confirmee') as nb_conf,
                 count(*) filter (where classe = 'annulee')   as nb_ann
          from classe group by 1
        ) c on c.heure = h
      ), '[]'::jsonb),

      'statutsLivraison', coalesce((
        select jsonb_agg(jsonb_build_object('nom', nom, 'valeur', n, 'couleur', couleur))
        from (
          select
            case statut_propre
              when 'en_attente'  then 'En attente'
              when 'livre'       then 'Livrée'
              when 'injoignable' then 'Injoignable'
              when 'retour'      then 'Retour'
              else statut_propre
            end as nom,
            case statut_propre
              when 'en_attente'  then '#FFB162'
              when 'livre'       then '#1B2632'
              when 'injoignable' then '#C9C1B1'
              when 'retour'      then '#A35139'
              else '#C9C1B1'
            end as couleur,
            count(*)::int as n
          from liv group by statut_propre
        ) s
      ), '[]'::jsonb),

      -- la répartition des commandes par statut d'appel, avec le NOM réel du
      -- statut tel qu'il est enregistré dans Paramètres
      'overviewAppels', coalesce((
        select jsonb_agg(jsonb_build_object('label', label, 'valeur', n, 'pct', pct) order by n desc)
        from (
          select coalesce(statut_confirmation, 'Pending') as label,
                 count(*)::int as n,
                 coalesce(round(100.0 * count(*) / nullif((select count(*) from classe), 0))::int, 0) as pct
          from classe group by 1
        ) s
      ), '[]'::jsonb),

      -- 29/10 : par PRODUIT (commandes.produit_id), plus par texte. Avant,
      -- « product c » et « product-c » étaient deux produits, chacun compté à
      -- moitié : le classement lu n'était pas le vrai. Les commandes dont le
      -- produit n'est pas dans le catalogue VISIBLE par l'appelant (cette
      -- fonction tourne avec ses droits : un vendeur ne voit que ses produits)
      -- font UNE ligne « Produit non reconnu », sans rang, en dernier :
      -- visible, jamais déguisée en produit.
      'topProduits', coalesce((
        select jsonb_agg(jsonb_build_object('rang', rang, 'nom', nom, 'qte', qte) order by rang nulls last)
        from (
          (select row_number() over (order by sum(coalesce(cl.quantite, 1)) desc, pr.product)::int as rang,
                  pr.product as nom,
                  sum(coalesce(cl.quantite, 1))::int as qte
             from classe cl join public.produits pr on pr.id = cl.produit_id
            group by pr.id, pr.product
            order by qte desc, pr.product
            limit 5)
          union all
          (select null::int, 'Produit non reconnu', sum(coalesce(cl.quantite, 1))::int
             from classe cl
            where cl.produit is not null and btrim(cl.produit) <> ''
              and not exists (select 1 from public.produits pr where pr.id = cl.produit_id)
           having count(*) > 0)
        ) s
      ), '[]'::jsonb),

      'topAgents', coalesce((
        select jsonb_agg(jsonb_build_object('nom', nom, 'livrees', livrees) order by livrees desc)
        from (
          select coalesce(ag.nom, 'Agent non assigné') as nom, pa.livrees
          from par_agent pa
          left join public.agents ag on ag.id = pa.agent_id
          where pa.livrees > 0
          order by pa.livrees desc limit 5
        ) s
      ), '[]'::jsonb),

      'analyticsAgents', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nom', nom, 'appels', appels, 'confirmees', confirmees,
                 'injoignables', injoignables, 'annulees', annulees,
                 'reprogrammees', reprogrammees, 'traitees', traitees,
                 'taux', taux) order by confirmees desc, appels desc)
        from (
          select coalesce(ag.nom, 'Agent non assigné') as nom,
                 coalesce(na.appels, 0) as appels,
                 pa.confirmees, pa.injoignables, pa.annulees, pa.reprogrammees,
                 (pa.confirmees + pa.injoignables + pa.annulees + pa.reprogrammees) as traitees,
                 coalesce(round(100.0 * pa.confirmees / nullif(
                   pa.confirmees + pa.injoignables + pa.annulees + pa.reprogrammees, 0))::int, 0) as taux
          from par_agent pa
          left join public.agents ag on ag.id = pa.agent_id
          left join nb_appels na on na.agent_id is not distinct from pa.agent_id
        ) s
      ), '[]'::jsonb),

      'totauxAgents', (
        select jsonb_build_object(
          'appels',        coalesce((select sum(appels) from nb_appels), 0),
          'confirmees',    coalesce(sum(confirmees), 0),
          'injoignables',  coalesce(sum(injoignables), 0),
          'annulees',      coalesce(sum(annulees), 0),
          'reprogrammees', coalesce(sum(reprogrammees), 0))
        from par_agent
      )
    )
  );
end;
$function$;
-- Marque (02/11) : ce fichier définit stats_dashboard. Les fichiers plus anciens qui
-- en ont une copie la lisent et ne la réécrivent plus.
comment on function public.stats_dashboard(uuid, timestamptz, timestamptz) is 'fichier: commandes_produit_id.sql';


-- -----------------------------------------------------------------------------
-- 8. Vérification
-- -----------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_zz_produit_commande' and tgenabled <> 'D') then
    raise exception 'trg_zz_produit_commande absent ou désactivé.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.commandes'::regclass
                  and contype = 'f' and confrelid = 'public.produits'::regclass and confdeltype = 'n') then
    raise exception 'commandes.produit_id doit être ON DELETE SET NULL.';
  end if;
  if exists (select 1 from pg_proc where proname = 'produit_de_commande' and prosrc ~ 'regexp_replace') then
    raise exception 'produit_de_commande recopie encore l''expression de normalisation.';
  end if;
  -- Chaque lien posé = la règle (aucun lien faux). 10/11 : la règle par vendeur
  -- quand produits_par_vendeur.sql est là ; jamais les commandes reliées par leur
  -- SKU de boutique (correspondances_sku.sql : leur texte est le titre de la
  -- boutique, pas un code — elles faisaient échouer ce contrôle depuis le 05/11).
  if to_regprocedure('public.produit_de_commande_vendeur(uuid, text, uuid)') is not null then
    -- Règle par vendeur : les liens posés AVANT elle restent tels quels (voulu,
    -- produits_par_vendeur.sql ne touche aucune commande) — dits, pas bloquants.
    execute $q$ select count(*) from public.commandes c
      cross join lateral public.produit_de_commande_vendeur(c.tenant_id, c.produit, c.vendeur_id) r
      where c.produit_id is not null and to_jsonb(c) ->> 'multiplicateur_sku' is null
        and c.produit_id is distinct from r.produit_id $q$ into v_n;
    if v_n > 0 then
      raise notice 'commandes_produit_id.sql : % commande(s) gardent un lien posé avant la règle par vendeur (non modifiées).', v_n;
    end if;
    v_n := 0;
  else
    select count(*) into v_n from public.commandes c
     cross join lateral public.produit_de_commande(c.tenant_id, c.produit) r
     where c.produit_id is not null and to_jsonb(c) ->> 'multiplicateur_sku' is null
       and c.produit_id is distinct from r.produit_id;
  end if;
  if v_n > 0 then raise exception '% commande(s) reliée(s) à un autre produit que celui de la règle.', v_n; end if;
  raise notice 'commandes_produit_id.sql : en place.';
end $$;


-- -----------------------------------------------------------------------------
-- 9. Répétition : de VRAIES écritures, puis tout est annulé
-- -----------------------------------------------------------------------------
-- Dans l'entreprise de test (17144700…) si elle a un pays, sinon la première.
--   1. une commande « PRODUCT-C  » (casse, espaces) → reliée au produit de
--      code product-c, texte gardé TEL QUEL, octet pour octet ;
--   2. texte changé en « potencia » → relié à l'autre produit ;
--   3. produit_id écrit à la main → refusé ;
--   4. produit renommé → la commande garde son lien et son texte ;
--   5. produit supprimé → la commande passe à NULL, texte inchangé ;
--   6. le rattrapage ne détache rien, et relie une commande restée vide
--      quand son produit arrive ;
--   7. stats_dashboard (fenêtre d'une minute, quantité 100 000 : première
--      quoi qu'il arrive) : la commande compte sous le nom de son produit,
--      rang 1 ; le produit supprimé, ses 100 000 passent dans « Produit non
--      reconnu », sans rang.
do $$
declare
  v_t   uuid;
  v_p   uuid;
  v_pa  uuid;
  v_pb  uuid;
  v_c   uuid;
  v_c2  uuid;
  v_lead text := 'REPETITION-' || replace(gen_random_uuid()::text, '-', '');
  v_code text := 'repet' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_msg text;
  v_j   jsonb;
  v_nr  integer;
begin
  select p.tenant_id, p.id into v_t, v_p from public.pays p
   order by (p.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, p.tenant_id, p.nom limit 1;
  if v_t is null then raise exception 'Répétition impossible : aucune entreprise avec un pays.'; end if;

  begin
    insert into public.produits (tenant_id, product, code) values (v_t, 'Répétition A', v_code || '-a') returning id into v_pa;
    insert into public.produits (tenant_id, product, code) values (v_t, 'Répétition B', v_code || '-b') returning id into v_pb;

    -- 1.
    insert into public.commandes (lead_id, tenant_id, pays_id, client_nom, client_telephone, produit, quantite, prix, produit_id)
    values (v_lead, v_t, v_p, 'Répétition', '+000', '  ' || upper(v_code) || '-A  ', 100000, 0, v_pb) returning id into v_c;
    if (select produit from public.commandes where id = v_c) is distinct from ('  ' || upper(v_code) || '-A  ') then
      raise exception 'le texte du produit a été réécrit';
    end if;
    if (select produit_id from public.commandes where id = v_c) is distinct from v_pa then
      raise exception 'insertion : pas relié au bon produit (un id envoyé a-t-il été gardé ?)';
    end if;

    -- 2.
    update public.commandes set produit = 'Répétition B' where id = v_c;
    if (select produit_id from public.commandes where id = v_c) is distinct from v_pb then
      raise exception 'texte changé : lien pas recalculé';
    end if;

    -- 3.
    v_msg := null;
    begin update public.commandes set produit_id = v_pa where id = v_c;
    exception when others then v_msg := sqlerrm; end;
    if v_msg is null or v_msg not like 'Le produit d''une commande se déduit de son texte%' then
      raise exception 'produit_id à la main : attendu un refus, obtenu « % »', coalesce(v_msg, 'accepté');
    end if;

    -- 4.
    update public.produits set product = 'Répétition B renommé', code = v_code || '-z' where id = v_pb;
    if (select produit_id from public.commandes where id = v_c) is distinct from v_pb
       or (select produit from public.commandes where id = v_c) <> 'Répétition B' then
      raise exception 'produit renommé : la commande a perdu son lien ou son texte';
    end if;
    if public.remplir_produits_commandes() < 0
       or (select produit_id from public.commandes where id = v_c) is distinct from v_pb then
      raise exception 'rattrapage : il a détaché une commande reliée';
    end if;

    -- 7. Fenêtre d'une minute et quantité 100 000 : la commande de répétition est
    --    première quoi qu'il se passe d'autre dans l'entreprise à ce moment.
    v_j := public.stats_dashboard(v_t, now() - interval '1 minute', now() + interval '1 minute') -> 'topProduits';
    if not exists (select 1 from jsonb_array_elements(v_j) e
                    where e->>'nom' = 'Répétition B renommé' and (e->>'qte')::int = 100000 and e->>'rang' = '1') then
      raise exception 'stats_dashboard : attendu Répétition B renommé ×100000 au rang 1 (sous le nom de son produit), obtenu %', v_j;
    end if;
    if exists (select 1 from jsonb_array_elements(v_j) e where e->>'nom' = 'Produit non reconnu' and e->>'rang' is not null) then
      raise exception 'stats_dashboard : « Produit non reconnu » a reçu un rang (%)', v_j;
    end if;
    select coalesce(max((e->>'qte')::int), 0) into v_nr from jsonb_array_elements(v_j) e where e->>'nom' = 'Produit non reconnu';

    -- 5.
    delete from public.produits where id = v_pb;
    if (select produit_id from public.commandes where id = v_c) is not null
       or (select produit from public.commandes where id = v_c) <> 'Répétition B' then
      raise exception 'produit supprimé : la commande n''est pas passée à NULL, ou son texte a bougé';
    end if;
    v_j := public.stats_dashboard(v_t, now() - interval '1 minute', now() + interval '1 minute') -> 'topProduits';
    if exists (select 1 from jsonb_array_elements(v_j) e where e->>'nom' like 'Répétition B%')
       or not exists (select 1 from jsonb_array_elements(v_j) e
                       where e->>'nom' = 'Produit non reconnu' and e->>'rang' is null and (e->>'qte')::int = v_nr + 100000) then
      raise exception 'stats_dashboard : produit supprimé, attendu ses 100 000 dans « Produit non reconnu » (sans rang), obtenu %', v_j;
    end if;

    -- 6.
    insert into public.commandes (lead_id, tenant_id, pays_id, client_nom, client_telephone, produit, quantite, prix)
    values (v_lead || '-2', v_t, v_p, 'Répétition', '+000', v_code || '-c', 1, 0) returning id into v_c2;
    if (select produit_id from public.commandes where id = v_c2) is not null then
      raise exception 'un texte inconnu a été relié à quelque chose';
    end if;
    insert into public.produits (tenant_id, product, code) values (v_t, 'Répétition C', v_code || '-c');
    perform public.remplir_produits_commandes();
    if (select produit_id from public.commandes where id = v_c2) is null then
      raise exception 'rattrapage : la commande n''a pas été reliée au produit arrivé après elle';
    end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'commandes_produit_id.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;

  if exists (select 1 from public.commandes where lead_id like v_lead || '%')
     or exists (select 1 from public.produits where code like v_code || '%') then
    raise exception 'Répétition : des écritures sont restées (elles auraient dû être annulées).';
  end if;
  raise notice 'commandes_produit_id.sql : répétition réussie (texte gardé, lien posé, recalculé, refusé à la main, renommé gardé, supprimé → non reconnu, rattrapage, dashboard), tout annulé.';
end $$;

-- Ce qui est en place (à lire) : par entreprise, combien de commandes reliées / non reconnues.
select t.nom_entreprise as entreprise,
       count(*) filter (where c.produit_id is not null) as reliees,
       count(*) filter (where c.produit_id is null) as non_reconnues
  from public.commandes c join public.tenants t on t.id = c.tenant_id
 group by t.nom_entreprise order by 1;
