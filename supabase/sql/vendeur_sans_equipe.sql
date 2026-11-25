-- =============================================================================
-- Le VENDEUR ne reçoit plus les livreurs ni les agents par deux vues
-- 02/11/2026 (bloc 4)
-- =============================================================================
--
-- NE CHANGE AUCUNE DONNÉE. Deux vues gagnent UNE condition :
--     lower(coalesce(mon_role(), '')) <> 'seller'
-- Mêmes colonnes, même corps (lu en production le 02/11, recopié tel quel) ;
-- pour tout autre compte (manager, admin, ceo, agent, livreur, super_admin,
-- service role, éditeur SQL) : exactement les mêmes lignes.
--
--   · v_caisses_livreur      — un vendeur y lisait l'argent encaissé sur SES
--     commandes, regroupé PAR LIVREUR, avec livreur_id. Aucune page ne la lui
--     demande (bande du livreur : voir_caisse ; Caisse livreurs : responsables).
--   · v_commandes_a_assigner — un vendeur y lisait agent_id de ses commandes
--     confirmées en attente de livreur. Seule Assignation livreur la lit.
--
-- Les deux restent security_invoker = on (la RLS de l'appelant s'applique
-- toujours en plus). Marque « fichier: vendeur_sans_equipe.sql » sur chacune
-- (règle de la garde du 02/11 : ce fichier les définit).
--
-- RÉPÉTITION (§3, annulée) : sous les droits d'un vendeur → 0 ligne dans les
-- deux ; sous ceux d'un manager → exactement les lignes de l'ancien corps
-- (comparées dans les deux sens). Un échec → rien n'est installé.
--
-- RETOUR ARRIÈRE : vendeur_sans_equipe_retour.sql (les corps du 02/11).
-- =============================================================================

-- 1. v_caisses_livreur
create or replace view public.v_caisses_livreur with (security_invoker = on) as
 SELECT p.tenant_id,
    l.id AS livreur_id,
    COALESCE(l.nom, 'Inconnu'::text) AS livreur_nom,
    COALESCE(pa.devise, 'N/A'::text) AS devise,
    sum(p.montant) AS total,
    count(*)::integer AS nb_paiements
   FROM paiements p
     LEFT JOIN livreurs l ON l.id = p.livreur_id
     LEFT JOIN commandes c ON c.id = p.commande_id
     LEFT JOIN pays pa ON pa.id = c.pays_id
  WHERE p.statut = 'encaisse'::text AND lower(COALESCE(public.mon_role(), ''::text)) <> 'seller'::text
  GROUP BY p.tenant_id, l.id, (COALESCE(l.nom, 'Inconnu'::text)), (COALESCE(pa.devise, 'N/A'::text));
comment on view public.v_caisses_livreur is 'fichier: vendeur_sans_equipe.sql';

-- 2. v_commandes_a_assigner
create or replace view public.v_commandes_a_assigner with (security_invoker = on) as
 SELECT id,
    lead_id,
    source,
    client_nom,
    client_telephone,
    produit,
    pays_id,
    zone_id,
    statut_confirmation,
    statut_livraison,
    statut_paiement,
    is_doublon,
    created_at,
    updated_at,
    date_commande,
    ville_zone,
    source_url,
    commentaire_1,
    whatsapp_tracking,
    source_sheet,
    whatsapp_followup,
    notes,
    commentaire_2,
    quantite,
    date_rappel,
    prix,
    tenant_id,
    agent_id
   FROM commandes c
  WHERE (EXISTS ( SELECT 1
           FROM statuts s
          WHERE s.tenant_id = c.tenant_id AND (s.nom = c.statut_confirmation OR s.code = c.statut_confirmation) AND (s.pays_id IS NULL OR s.pays_id = c.pays_id) AND s.declenche_assignation = true)) AND NOT (EXISTS ( SELECT 1
           FROM livraisons v
          WHERE v.commande_id = c.id)) AND lower(COALESCE(public.mon_role(), ''::text)) <> 'seller'::text;
comment on view public.v_commandes_a_assigner is 'fichier: vendeur_sans_equipe.sql';

-- 3. Répétition
do $$
declare
  v_t    uuid;
  v_vend uuid;
  v_resp uuid;
  v_n    integer;
  v_msg  text;
begin
  select ur.tenant_id into v_t from public.user_roles ur
   where ur.role = 'seller'
     and exists (select 1 from public.user_roles m where m.tenant_id = ur.tenant_id and m.role in ('manager', 'admin'))
   order by (ur.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, ur.tenant_id limit 1;
  if v_t is null then
    raise notice 'Répétition sautée : aucune entreprise avec un vendeur et un manager.';
    return;
  end if;
  select user_id into v_vend from public.user_roles where tenant_id = v_t and role = 'seller' order by user_id limit 1;
  select user_id into v_resp from public.user_roles where tenant_id = v_t and role in ('manager', 'admin') order by role desc, user_id limit 1;

  begin
    -- le vendeur : rien
    perform set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.v_caisses_livreur;
    if v_n <> 0 then raise exception 'vendeur : % ligne(s) dans v_caisses_livreur', v_n; end if;
    select count(*) into v_n from public.v_commandes_a_assigner;
    if v_n <> 0 then raise exception 'vendeur : % ligne(s) dans v_commandes_a_assigner', v_n; end if;
    execute 'reset role';

    -- le manager : exactement l'ancien corps, dans les deux sens
    perform set_config('request.jwt.claims', json_build_object('sub', v_resp, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from (
      (select * from public.v_caisses_livreur except all
 SELECT p.tenant_id,
    l.id AS livreur_id,
    COALESCE(l.nom, 'Inconnu'::text) AS livreur_nom,
    COALESCE(pa.devise, 'N/A'::text) AS devise,
    sum(p.montant) AS total,
    count(*)::integer AS nb_paiements
   FROM paiements p
     LEFT JOIN livreurs l ON l.id = p.livreur_id
     LEFT JOIN commandes c ON c.id = p.commande_id
     LEFT JOIN pays pa ON pa.id = c.pays_id
  WHERE p.statut = 'encaisse'::text
  GROUP BY p.tenant_id, l.id, (COALESCE(l.nom, 'Inconnu'::text)), (COALESCE(pa.devise, 'N/A'::text)))
      union all
      (select * from (
 SELECT p.tenant_id,
    l.id AS livreur_id,
    COALESCE(l.nom, 'Inconnu'::text) AS livreur_nom,
    COALESCE(pa.devise, 'N/A'::text) AS devise,
    sum(p.montant) AS total,
    count(*)::integer AS nb_paiements
   FROM paiements p
     LEFT JOIN livreurs l ON l.id = p.livreur_id
     LEFT JOIN commandes c ON c.id = p.commande_id
     LEFT JOIN pays pa ON pa.id = c.pays_id
  WHERE p.statut = 'encaisse'::text
  GROUP BY p.tenant_id, l.id, (COALESCE(l.nom, 'Inconnu'::text)), (COALESCE(pa.devise, 'N/A'::text))) ancien except all select * from public.v_caisses_livreur)) d;
    if v_n <> 0 then raise exception 'manager : v_caisses_livreur diffère de l''ancien corps (% ligne(s))', v_n; end if;
    select count(*) into v_n from (
      (select * from public.v_commandes_a_assigner except all
 SELECT id,
    lead_id,
    source,
    client_nom,
    client_telephone,
    produit,
    pays_id,
    zone_id,
    statut_confirmation,
    statut_livraison,
    statut_paiement,
    is_doublon,
    created_at,
    updated_at,
    date_commande,
    ville_zone,
    source_url,
    commentaire_1,
    whatsapp_tracking,
    source_sheet,
    whatsapp_followup,
    notes,
    commentaire_2,
    quantite,
    date_rappel,
    prix,
    tenant_id,
    agent_id
   FROM commandes c
  WHERE (EXISTS ( SELECT 1
           FROM statuts s
          WHERE s.tenant_id = c.tenant_id AND (s.nom = c.statut_confirmation OR s.code = c.statut_confirmation) AND (s.pays_id IS NULL OR s.pays_id = c.pays_id) AND s.declenche_assignation = true)) AND NOT (EXISTS ( SELECT 1
           FROM livraisons v
          WHERE v.commande_id = c.id)))
      union all
      (select * from (
 SELECT id,
    lead_id,
    source,
    client_nom,
    client_telephone,
    produit,
    pays_id,
    zone_id,
    statut_confirmation,
    statut_livraison,
    statut_paiement,
    is_doublon,
    created_at,
    updated_at,
    date_commande,
    ville_zone,
    source_url,
    commentaire_1,
    whatsapp_tracking,
    source_sheet,
    whatsapp_followup,
    notes,
    commentaire_2,
    quantite,
    date_rappel,
    prix,
    tenant_id,
    agent_id
   FROM commandes c
  WHERE (EXISTS ( SELECT 1
           FROM statuts s
          WHERE s.tenant_id = c.tenant_id AND (s.nom = c.statut_confirmation OR s.code = c.statut_confirmation) AND (s.pays_id IS NULL OR s.pays_id = c.pays_id) AND s.declenche_assignation = true)) AND NOT (EXISTS ( SELECT 1
           FROM livraisons v
          WHERE v.commande_id = c.id))) ancien except all select * from public.v_commandes_a_assigner)) d;
    if v_n <> 0 then raise exception 'manager : v_commandes_a_assigner diffère de l''ancien corps (% ligne(s))', v_n; end if;
    execute 'reset role';

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'vendeur_sans_equipe.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;
  raise notice 'vendeur_sans_equipe.sql : vendeur → 0 ligne dans les deux vues ; manager → les mêmes lignes qu''avant (répétition annulée).';
end $$;
