-- =============================================================================
-- RETOUR ARRIÈRE COMPLET de commandes_produit_id.sql
-- =============================================================================
--
-- Remet la base dans l'état d'AVANT le fichier :
--   1. stats_dashboard : le corps de production lu le 29/10 (« Top Produits »
--      par texte), recopié tel quel — VÉRIFIÉ : md5 ad8a7de2cb734f63bc32ddee2b69d377 ;
--   2. produit_de_commande : le corps de production lu le 29/10 (expression
--      recopiée, sans texte_normalise) — VÉRIFIÉ : md5 4112f39b12057d67b1daaf1a36df44e2 ;
--   3. retire le trigger trg_zz_produit_commande et ses fonctions ;
--   4. supprime commandes.produit_id (son index et sa clé partent avec).
-- Le TEXTE des commandes n'a jamais été touché : rien à remettre.
-- Si une vérification échoue, tout est annulé (une transaction).
--
-- LES PAGES : celles de ce changement lisent produit_id. Les remettre avec
-- le retour (voir le compte rendu : le commit à reprendre), puis pousser.
-- Exécutable en entier, deux fois, et même si le fichier n'a jamais tourné.
-- =============================================================================

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

      'topProduits', coalesce((
        select jsonb_agg(jsonb_build_object('rang', rang, 'nom', nom, 'qte', qte) order by rang)
        from (
          select row_number() over (order by sum(coalesce(quantite, 1)) desc)::int as rang,
                 produit as nom,
                 sum(coalesce(quantite, 1))::int as qte
          from classe where produit is not null and btrim(produit) <> ''
          group by produit order by qte desc limit 5
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
-- Marque (02/11) : le corps remis est celui de statut_pending.sql — il porte sa marque,
-- pour qu'un nouveau passage de statut_pending.sql ne s'arrête pas sur une marque fausse.
comment on function public.stats_dashboard(uuid, timestamptz, timestamptz) is 'fichier: statut_pending.sql';

CREATE OR REPLACE FUNCTION public.produit_de_commande(p_tenant uuid, p_produit text)
 RETURNS TABLE(produit_id uuid, cas text, raison text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_nom := lower(regexp_replace(btrim(public.unaccent_simple(v_texte)), '\s+', ' ', 'g'));

  select count(*), min(p.id::text)::uuid into v_combien, v_produit
    from public.produits p
   where p.tenant_id = p_tenant
     and p.code is not null and btrim(p.code) <> ''
     and lower(regexp_replace(btrim(public.unaccent_simple(p.code)), '\s+', ' ', 'g')) = v_nom;
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
     and lower(regexp_replace(btrim(public.unaccent_simple(p.product)), '\s+', ' ', 'g')) = v_nom;

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
$function$;
revoke all on function public.produit_de_commande(uuid, text) from public, anon, authenticated;

drop trigger if exists trg_zz_produit_commande on public.commandes;
drop function if exists public.commande_produit_id();
drop function if exists public.remplir_produits_commandes();
alter table public.commandes drop column if exists produit_id;

do $$
declare v_s text; v_p text;
begin
  select md5(prosrc) into v_s from pg_proc where oid = 'public.stats_dashboard(uuid, timestamptz, timestamptz)'::regprocedure;
  select md5(prosrc) into v_p from pg_proc where oid = 'public.produit_de_commande(uuid, text)'::regprocedure;
  if v_s is distinct from 'ad8a7de2cb734f63bc32ddee2b69d377' then
    raise exception 'Retour : stats_dashboard n''est pas exactement celui d''avant (md5 %). Rien n''a été fait.', v_s;
  end if;
  if v_p is distinct from '4112f39b12057d67b1daaf1a36df44e2' then
    raise exception 'Retour : produit_de_commande n''est pas exactement celui d''avant (md5 %). Rien n''a été fait.', v_p;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commandes' and column_name = 'produit_id')
     or exists (select 1 from pg_trigger where tgname = 'trg_zz_produit_commande')
     or exists (select 1 from pg_proc where proname in ('commande_produit_id', 'remplir_produits_commandes')) then
    raise exception 'Retour incomplet : colonne, trigger ou fonction encore là. Rien n''a été fait.';
  end if;
  raise notice 'Retour arrière complet : stats_dashboard et produit_de_commande identiques à ceux d''avant (md5 vérifiés), produit_id retiré. Remettez les pages.';
end $$;
