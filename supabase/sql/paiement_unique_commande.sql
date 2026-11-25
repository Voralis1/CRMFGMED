-- =============================================================================
-- UN SEUL PAIEMENT PAR COMMANDE — 03/11/2026
-- NE MODIFIE AUCUNE DONNÉE. Ajoute une règle (index unique). Rejouable.
-- =============================================================================
--
-- LE TROU : confirmer-livraison passe la livraison à « livré », PUIS regarde
-- si la commande a déjà un paiement, PUIS le crée. Deux « Livré » au même
-- instant (double appui, réseau qui renvoie, livreur + manager) passent tous
-- les deux le contrôle avant que l'un écrive : deux paiements pour une
-- commande, l'argent compté deux fois dans la caisse du livreur. Rien dans la
-- base ne l'interdisait (lu le 03/11 : aucun index unique sur
-- paiements.commande_id ; 0 doublon aujourd'hui).
--
-- LA RÈGLE : un index unique sur paiements (commande_id). Le second insert
-- est refusé par la base, quel que soit le chemin ; la commande garde UN
-- paiement. (Le message vu par le livreur reste technique — « duplicate
-- key » — : un message propre demande de modifier confirmer-livraison +
-- un déploiement. Décidé le 03/11 : plus tard.)
--
--   §1 s'arrête et NOMME les commandes qui ont déjà plusieurs paiements
--      (rien n'est créé) ;
--   §2 l'index ;
--   §3 répétition (annulée) : un second paiement est refusé.
--
-- RETOUR ARRIÈRE : paiement_unique_commande_retour.sql (copie sur le Bureau :
-- RETOUR_paiement_unique_commande.sql).
-- =============================================================================

begin;

-- §1 Doublons existants ---------------------------------------------------------
do $$
declare v_liste text; n integer;
begin
  select count(*), string_agg(coalesce(c.tracking_number, d.commande_id::text) || ' (' || d.n || ' paiements)', ', ')
    into n, v_liste
    from (select commande_id, count(*) as n from public.paiements group by commande_id having count(*) > 1) d
    left join public.commandes c on c.id = d.commande_id;
  if n > 0 then
    raise exception 'paiement_unique_commande.sql : % commande(s) ont déjà plusieurs paiements : %. Rien n''est créé — à régler d''abord, une par une.', n, left(v_liste, 1500);
  end if;
end $$;

-- §2 La règle -------------------------------------------------------------------
create unique index if not exists paiements_commande_unique on public.paiements (commande_id);

do $$
begin
  -- « if not exists » garderait en silence un index du même nom sur d'autres colonnes (leçon 12).
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'paiements'
                  and indexname = 'paiements_commande_unique'
                  and indexdef = 'CREATE UNIQUE INDEX paiements_commande_unique ON public.paiements USING btree (commande_id)') then
    raise exception 'paiement_unique_commande.sql : un index « paiements_commande_unique » existe mais n''est pas « unique (commande_id) ». Rien n''est créé.';
  end if;
end $$;

-- §3 Répétition (annulée) ---------------------------------------------------------
do $$
declare v_msg text; v_refus boolean := false;
begin
  if not exists (select 1 from public.paiements) then
    raise notice 'Répétition sautée : aucun paiement en base.';
    return;
  end if;
  begin
    insert into public.paiements (commande_id, livreur_id, tenant_id, montant, methode, statut)
    select commande_id, livreur_id, tenant_id, 1, 'cod', 'en_attente' from public.paiements limit 1;
  exception when unique_violation then v_refus := true;
  end;
  if not v_refus then
    raise exception 'paiement_unique_commande.sql — RÉPÉTITION ÉCHOUÉE : un second paiement pour la même commande est accepté. Rien n''est créé.';
  end if;
  raise notice 'paiement_unique_commande.sql : un seul paiement par commande (second paiement refusé, répétition annulée).';
end $$;

commit;

-- Ce qui est en place
select indexname, indexdef from pg_indexes where tablename = 'paiements' order by indexname;
