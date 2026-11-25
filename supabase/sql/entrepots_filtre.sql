-- =============================================================================
-- LE FILTRE PAR ENTREPÔT — 11/11/2026 (sa demande : un choix d'entrepôt en haut, à
-- côté du nom du compte, qui filtre tous les écrans)
-- NE MODIFIE AUCUNE DONNÉE. Ajoute 3 fonctions de lecture.
-- =============================================================================
--
-- SA RÈGLE : chaque entreprise a ses entrepôts — jamais ceux d'une autre. Un
-- responsable (manager, admin, ceo), un agent, un livreur : tous les entrepôts de
-- son entreprise. Un VENDEUR : seulement ceux où SES produits ont une ligne de
-- stock (il ne lit pas la table entrepots : la RLS le lui ferme ; ici il reçoit
-- le nom, jamais le stock). Le super admin : ceux de l'entreprise qu'il regarde.
--
--   · entrepots_du_compte(entreprise) : la liste du menu (id, nom, pays, code du pays pour le drapeau).
--   · produits_de_l_entrepot(entreprise, entrepôt) : les produits qui ont une ligne
--     de stock dans cet entrepôt (le vendeur : les siens seulement) — l'écran
--     Produits filtre avec.
--   · stats_dashboard(entreprise, début, fin, entrepôt) : le tableau de bord d'UN
--     entrepôt — le corps de prod (commandes_produit_id.sql, md5 376fa0fc…) avec,
--     en plus, « commande de cet entrepôt » sur les commandes, livraisons, appels et
--     paiements. Entrepôt vide = l'entreprise entière. La version à 3 arguments
--     ne change pas.
--
-- RETOUR ARRIÈRE : entrepots_filtre_retour.sql (copie sur le Bureau).
-- =============================================================================

begin;

drop function if exists public.entrepots_du_compte(uuid);
create or replace function public.entrepots_du_compte(p_tenant uuid)
returns table (id uuid, nom text, pays_id uuid, pays_nom text, pays_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_super_admin() or p_tenant = public.get_my_tenant_id()) then
    raise exception 'Cette entreprise n''est pas la vôtre.' using errcode = '42501';
  end if;
  if not public.is_super_admin() and lower(coalesce(public.mon_role(), '')) = 'seller' then
    return query
      select e.id, e.nom, e.pays_id, pa.nom, pa.code
        from public.entrepots e left join public.pays pa on pa.id = e.pays_id
       where e.tenant_id = p_tenant
         and exists (select 1 from public.stocks s join public.produits p on p.id = s.produit_id
                      where s.entrepot_id = e.id and p.vendeur_id = auth.uid())
       order by e.nom;
    return;
  end if;
  return query
    select e.id, e.nom, e.pays_id, pa.nom, pa.code
      from public.entrepots e left join public.pays pa on pa.id = e.pays_id
     where e.tenant_id = p_tenant
     order by e.nom;
end;
$$;
revoke all on function public.entrepots_du_compte(uuid) from public, anon;
grant execute on function public.entrepots_du_compte(uuid) to authenticated, service_role;
comment on function public.entrepots_du_compte(uuid) is 'fichier: entrepots_filtre.sql';

create or replace function public.produits_de_l_entrepot(p_tenant uuid, p_entrepot uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_super_admin() or p_tenant = public.get_my_tenant_id()) then
    raise exception 'Cette entreprise n''est pas la vôtre.' using errcode = '42501';
  end if;
  return query
    select distinct s.produit_id
      from public.stocks s join public.produits p on p.id = s.produit_id
     where s.tenant_id = p_tenant and s.entrepot_id = p_entrepot
       and (public.is_super_admin() or lower(coalesce(public.mon_role(), '')) <> 'seller' or p.vendeur_id = auth.uid());
end;
$$;
revoke all on function public.produits_de_l_entrepot(uuid, uuid) from public, anon;
grant execute on function public.produits_de_l_entrepot(uuid, uuid) to authenticated, service_role;
comment on function public.produits_de_l_entrepot(uuid, uuid) is 'fichier: entrepots_filtre.sql';

-- Le tableau de bord d'un entrepôt (la RLS de l'appelant s'applique, comme la version d'origine).
CREATE OR REPLACE FUNCTION public.stats_dashboard(p_tenant uuid, p_debut timestamp with time zone, p_fin timestamp with time zone, p_entrepot uuid)
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
        and (p_entrepot is null or c.entrepot_id = p_entrepot)
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
        and (p_entrepot is null or exists (select 1 from public.commandes c0 where c0.id = v.commande_id and c0.entrepot_id = p_entrepot))
    ),
    -- un appel par commande : sinon un agent qui rappelle 3 fois compte 3 fois
    appel_cmd as (
      select distinct on (a.commande_id) a.commande_id, a.agent_id
      from public.appels a
      where a.tenant_id = p_tenant
        and a.created_at >= p_debut and a.created_at <= p_fin
        and (p_entrepot is null or exists (select 1 from public.commandes c0 where c0.id = a.commande_id and c0.entrepot_id = p_entrepot))
      order by a.commande_id, a.created_at
    ),
    nb_appels as (
      select a.agent_id, count(*)::int as appels
      from public.appels a
      where a.tenant_id = p_tenant
        and a.created_at >= p_debut and a.created_at <= p_fin
        and (p_entrepot is null or exists (select 1 from public.commandes c0 where c0.id = a.commande_id and c0.entrepot_id = p_entrepot))
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
            and (p_entrepot is null or c.entrepot_id = p_entrepot)
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
revoke all on function public.stats_dashboard(uuid, timestamp with time zone, timestamp with time zone, uuid) from public, anon;
grant execute on function public.stats_dashboard(uuid, timestamp with time zone, timestamp with time zone, uuid) to authenticated, service_role;
comment on function public.stats_dashboard(uuid, timestamp with time zone, timestamp with time zone, uuid) is 'fichier: entrepots_filtre.sql';

do $$
begin
  if (select count(*) from pg_proc where proname = 'stats_dashboard') <> 2 then
    raise exception 'entrepots_filtre.sql : les deux tableaux de bord (entreprise, entrepôt) ne sont pas là. Rien n''est installé.';
  end if;
  raise notice 'entrepots_filtre.sql : menu des entrepôts du compte, produits d''un entrepôt, tableau de bord par entrepôt. Aucune donnée modifiée.';
end $$;

commit;
