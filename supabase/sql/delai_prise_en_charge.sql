-- =============================================================================
-- DÉLAI DE PREMIÈRE PRISE EN CHARGE ENREGISTRÉE — 02/11/2026
-- =============================================================================
--
-- MESURE SEULEMENT. Ne change aucune commande, aucun historique, aucune
-- affectation, aucun écran d'agent. Aucune colonne ajoutée.
--
-- CE QUI EST MESURÉ — « première prise en charge ENREGISTRÉE », pas « premier
-- appel » : un agent qui ouvre le panneau et le referme sans enregistrer ne
-- laisse aucune trace.
--
--   DÉPART = le plus tard de :
--     · commandes.entree_file (= remonte_le si le lead a été remonté, sinon
--       created_at) ;
--     · le dernier retour à « Pending » (ligne d'historique vers Pending depuis
--       un autre statut : « Renvoyer en attente »).
--     ⚠ Écart voulu avec « le départ = entree_file » (sa décision du 02/11) :
--     un lead renvoyé en attente attend DE NOUVEAU ; le mesurer depuis sa
--     création le marquerait en retard pour toujours.
--
--   ARRIVÉE = le moment où l'agent a COMMENCÉ l'appel : l'heure
--   d'enregistrement de la ligne d'historique MOINS sa durée (= le clic sur
--   « Traiter »). La première ligne, depuis le départ, qui :
--     · est une prise en charge — est_prise_en_charge() : pas un lot (une
--       action en masse : personne n'a appelé), vers un statut ≠ « Pending ».
--       « Non joint » compte : il a appelé, personne n'a répondu ;
--     · ET porte une durée. Une correction du manager depuis le tiroir
--       Commandes passe par confirmer-appel SANS durée : ce n'est pas un appel.
--       Lu le 02/11 : les 5 lignes sans durée sont toutes des corrections
--       (« Statut corrigé depuis Commandes »), aucune n'est un appel. Coût
--       connu : confirmer-appel n'enregistre pas une durée > 3600 s — un
--       panneau resté ouvert plus d'une heure ne compterait pas (aucun le 02/11).
--
--   Trois états, une seule fois chacun (leur somme = toutes les commandes) :
--     · PRIS EN CHARGE  — une arrivée existe ;
--     · EN ATTENTE      — pas d'arrivée, statut encore ouvert (ferme_le_lead
--                         faux, ou Pending) ;
--     · FERMÉ SANS PRISE EN CHARGE — pas d'arrivée, statut qui ferme.
--
--   PÉRIODE : s'applique aux pris en charge (et aux fermés), par date de
--   DÉPART. « En attente » est toujours MAINTENANT, sans période.
--
--   PAR AGENT : un lead pris en charge compte pour celui qui a ENREGISTRÉ la
--   prise en charge (comme Performances compte les appels) ; un lead en
--   attente compte pour l'agent à qui il est AFFECTÉ, ou « Sans agent ».
--
-- est_prise_en_charge : la règle « pas un lot, pas Pending » écrite UNE fois.
-- est_tentative est réécrite dessus (est_prise_en_charge ET statut ouvert) ;
-- §3 prouve, avant de valider, qu'elle donne la même réponse sur CHAQUE ligne
-- d'historique et sur chaque statut de chaque entreprise. Un écart → rien
-- n'est installé. commandes_statut_lot.sql garde sa copie de est_tentative
-- derrière une garde (marque « fichier: delai_prise_en_charge.sql »).
--
-- DROITS : delai_prise_en_charge() lit l'historique avec les droits du
-- propriétaire (les comptes de l'app n'ont pas de droit sur la table) et
-- refuse tout le monde sauf manager, admin, ceo de l'entreprise et
-- super_admin. Ni le vendeur, ni l'agent, ni le livreur.
--
-- RETOUR ARRIÈRE : delai_prise_en_charge_retour.sql.
-- =============================================================================

-- 1. Prérequis
do $$
begin
  if to_regprocedure('public.est_tentative(uuid, text, uuid)') is null
     or to_regprocedure('public.est_statut_ouvert(uuid, text)') is null then
    raise exception 'Lancez d''abord commandes_statut_lot.sql (est_tentative, est_statut_ouvert). Rien n''a été installé.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'historique_statuts' and column_name = 'lot_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'commandes' and column_name = 'entree_file') then
    raise exception 'historique_statuts.lot_id ou commandes.entree_file manque. Rien n''a été installé.';
  end if;
end $$;

-- 2. La règle « pas un lot, pas Pending », une fois
create or replace function public.est_prise_en_charge(p_statut text, p_lot uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_lot is null and p_statut is not null and p_statut <> 'Pending'
$$;
comment on function public.est_prise_en_charge(text, uuid) is 'fichier: delai_prise_en_charge.sql';
revoke all on function public.est_prise_en_charge(text, uuid) from public, anon;
grant execute on function public.est_prise_en_charge(text, uuid) to authenticated, service_role;

-- 3. est_tentative réécrite dessus — même réponse partout, prouvé
drop table if exists pg_temp._tentative_avant;
create temp table _tentative_avant as
  select 'h:' || h.id::text as cle, public.est_tentative(h.tenant_id, h.statut, h.lot_id) as t
    from public.historique_statuts h
  union all
  select 's:' || x.tenant_id || ':' || coalesce(x.statut, '∅') || ':' || x.lot, public.est_tentative(x.tenant_id, x.statut, case when x.lot then gen_random_uuid() end)
    from (select t.id as tenant_id, s.statut, l.lot
            from public.tenants t
           cross join lateral (select s.nom as statut from public.statuts s where s.tenant_id = t.id
                               union select 'Pending' union select null::text union select 'Statut inconnu') s
           cross join (values (true), (false)) l(lot)) x;

create or replace function public.est_tentative(p_tenant uuid, p_statut text, p_lot uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select public.est_prise_en_charge(p_statut, p_lot)
     and public.est_statut_ouvert(p_tenant, p_statut)
$$;
comment on function public.est_tentative(uuid, text, uuid) is 'fichier: delai_prise_en_charge.sql';
revoke all on function public.est_tentative(uuid, text, uuid) from public, anon;
grant execute on function public.est_tentative(uuid, text, uuid) to authenticated, service_role;

do $$
declare v_ecarts integer; v_n integer;
begin
  select count(*) into v_n from _tentative_avant;
  select count(*) into v_ecarts
    from _tentative_avant a
   where a.t is distinct from (
     case when a.cle like 'h:%' then
       (select public.est_tentative(h.tenant_id, h.statut, h.lot_id) from public.historique_statuts h where h.id = substr(a.cle, 3)::uuid)
     else
       public.est_tentative(split_part(a.cle, ':', 2)::uuid,
                            nullif(split_part(a.cle, ':', 3), '∅'),
                            case when split_part(a.cle, ':', 4) = 'true' then gen_random_uuid() end)
     end);
  if v_ecarts > 0 then
    raise exception 'est_tentative réécrite : % réponse(s) sur % différente(s) de l''ancienne. Rien n''a été installé.', v_ecarts, v_n;
  end if;
  raise notice 'est_tentative réécrite : % réponses comparées (chaque ligne d''historique, chaque statut × lot), 0 écart.', v_n;
end $$;
drop table if exists pg_temp._tentative_avant;

-- 4. Un résumé de durées (minutes) : nombre, moyenne, médiane, max, tranches
create or replace function public.resume_delais(p_minutes numeric[])
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'n',           count(x),
    'moyenne_min', round(avg(x), 1),
    'mediane_min', round((percentile_cont(0.5) within group (order by x))::numeric, 1),
    'max_min',     round(max(x), 1),
    'tranches',    jsonb_build_object(
                     'moins_15_min', count(*) filter (where x < 15),
                     'de_15_min_a_1_h', count(*) filter (where x >= 15 and x < 60),
                     'de_1_h_a_3_h', count(*) filter (where x >= 60 and x < 180),
                     'plus_3_h', count(*) filter (where x >= 180)))
    from unnest(p_minutes) x
$$;
comment on function public.resume_delais(numeric[]) is 'fichier: delai_prise_en_charge.sql';
revoke all on function public.resume_delais(numeric[]) from public, anon, authenticated;

-- 5. La mesure
create or replace function public.delai_prise_en_charge(p_tenant uuid, p_debut timestamptz, p_fin timestamptz)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if not (public.is_super_admin()
          or (p_tenant = public.get_my_tenant_id() and public.est_responsable())) then
    raise exception 'Accès refusé : le délai de prise en charge est réservé aux responsables de l''entreprise.'
      using errcode = '42501';
  end if;

  return (
    with c as (
      select c.id, c.agent_id, c.statut_confirmation,
             greatest(c.entree_file,
                      coalesce((select max(h.cree_le) from public.historique_statuts h
                                 where h.commande_id = c.id and h.statut = 'Pending'
                                   and h.statut_precedent is not null and h.statut_precedent <> 'Pending'),
                               c.entree_file)) as depart
        from public.commandes c
       where c.tenant_id = p_tenant
    ),
    p as (
      select c.*, pr.fait_par, pr.fait_par_nom, pr.debut_appel,
             public.est_statut_ouvert(p_tenant, c.statut_confirmation) as ouvert
        from c
        left join lateral (
          select h.fait_par, h.fait_par_nom,
                 h.cree_le - make_interval(secs => h.duree_secondes) as debut_appel
            from public.historique_statuts h
           where h.commande_id = c.id
             and public.est_prise_en_charge(h.statut, h.lot_id)
             and h.duree_secondes is not null      -- correction du tiroir Commandes : pas un appel
             and h.cree_le >= c.depart
           order by h.cree_le, h.id
           limit 1) pr on true
    ),
    m as (
      select p.*,
             case when p.debut_appel is not null
                  then greatest(0, extract(epoch from (p.debut_appel - p.depart)) / 60.0)::numeric end as min_pris,
             case when p.debut_appel is null and p.ouvert
                  then (extract(epoch from (now() - p.depart)) / 60.0)::numeric end as min_attente
        from p
    ),
    pris as (select * from m where min_pris is not null and depart >= p_debut and depart <= p_fin),
    att  as (select * from m where min_attente is not null),
    lp as (
      select coalesce(a.id::text, 'u:' || pris.fait_par::text, 'inconnu') as cle,
             coalesce(a.nom, pris.fait_par_nom, 'Inconnu') as nom, pris.min_pris
        from pris left join public.agents a on a.user_id = pris.fait_par and a.tenant_id = p_tenant
    ),
    la as (
      select coalesce(a.id::text, 'sans') as cle, coalesce(a.nom, 'Sans agent') as nom, att.min_attente
        from att left join public.agents a on a.id = att.agent_id
    ),
    cles as (
      select cle, max(nom) as nom from (
        select cle, nom from lp
        union all select cle, nom from la
        union all select a.id::text, a.nom from public.agents a where a.tenant_id = p_tenant and a.actif
      ) u group by cle
    )
    select jsonb_build_object(
      'pris_en_charge',  public.resume_delais(array(select min_pris from pris)),
      'en_attente',      public.resume_delais(array(select min_attente from att)),
      'fermes_sans_prise_en_charge',
                         (select count(*) from m where debut_appel is null and not ouvert
                             and depart >= p_debut and depart <= p_fin),
      'par_agent', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'cle', k.cle, 'agent', k.nom,
                 'pris_en_charge', public.resume_delais(array(select lp.min_pris from lp where lp.cle = k.cle)),
                 'en_attente',     public.resume_delais(array(select la.min_attente from la where la.cle = k.cle)))
               order by (k.cle = 'sans'), k.nom)
          from cles k), '[]'::jsonb))
  );
end;
$$;
comment on function public.delai_prise_en_charge(uuid, timestamptz, timestamptz) is 'fichier: delai_prise_en_charge.sql';
revoke all on function public.delai_prise_en_charge(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.delai_prise_en_charge(uuid, timestamptz, timestamptz) to authenticated;

-- 6. Répétition (annulée) : qui peut lire ; chaque commande tombe dans un et un seul état
do $$
declare
  v_t     uuid;
  v_resp  uuid;
  v_vend  uuid;
  v_agent uuid;
  v_j     jsonb;
  v_total integer;
  v_somme integer;
  v_msg   text;
  v_refus boolean;
begin
  select ur.tenant_id into v_t from public.user_roles ur
   where ur.role in ('manager', 'admin')
   order by (ur.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, ur.tenant_id limit 1;
  if v_t is null then raise notice 'Répétition sautée : aucune entreprise avec un manager.'; return; end if;
  select user_id into v_resp  from public.user_roles where tenant_id = v_t and role in ('manager', 'admin') order by role desc, user_id limit 1;
  select user_id into v_vend  from public.user_roles where tenant_id = v_t and role = 'seller' order by user_id limit 1;
  select user_id into v_agent from public.user_roles where tenant_id = v_t and role = 'agent'  order by user_id limit 1;
  select count(*) into v_total from public.commandes where tenant_id = v_t;

  begin
    -- le manager : la mesure, et la partition (pris + en attente + fermés = toutes)
    perform set_config('request.jwt.claims', json_build_object('sub', v_resp, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.delai_prise_en_charge(v_t, '-infinity', 'infinity');
    execute 'reset role';
    v_somme := (v_j -> 'pris_en_charge' ->> 'n')::int + (v_j -> 'en_attente' ->> 'n')::int
               + (v_j ->> 'fermes_sans_prise_en_charge')::int;
    if v_somme <> v_total then
      raise exception 'partition fausse : % pris + en attente + fermés pour % commandes', v_somme, v_total;
    end if;

    -- le vendeur, l'agent : refusés
    foreach v_msg in array array[coalesce(v_vend::text, ''), coalesce(v_agent::text, '')] loop
      continue when v_msg = '';
      perform set_config('request.jwt.claims', json_build_object('sub', v_msg, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_refus := false;
      begin
        perform public.delai_prise_en_charge(v_t, '-infinity', 'infinity');
      exception when insufficient_privilege then v_refus := true;
      end;
      execute 'reset role';
      if not v_refus then raise exception 'un vendeur ou un agent lit le délai de prise en charge'; end if;
    end loop;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'delai_prise_en_charge.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;
  raise notice 'delai_prise_en_charge.sql : en place ; manager → chaque commande dans un seul état ; vendeur et agent refusés (répétition annulée).';
end $$;
