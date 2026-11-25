-- =============================================================================
-- RETOUR ARRIÈRE de historique_affectations.sql — à coller si les écritures
-- sur commandes ou livraisons cassent après son installation.
-- =============================================================================
--
-- Retire les QUATRE triggers, dans cet ordre :
--   1. trg_historique_agent   (sur commandes)  — peut bloquer chaque création
--      de commande et chaque changement d'agent ;
--   2. trg_historique_livreur (sur livraisons) — peut bloquer chaque création
--      de livraison (la confirmation qui envoie au livreur) et chaque
--      changement de livreur ;
--   3. trg_historique_affectations_garde (sur la table) — peut bloquer la
--      SUPPRESSION d'une commande (le SET NULL passe par lui) ;
--   4. trg_historique_affectations_garde_vider (même table, TRUNCATE).
--
-- Ce qui RESTE, exprès : la table et ses lignes, la vue, les fonctions.
-- affecter_agent_lot / affecter_livreur_lot continuent de marcher sans les
-- triggers (ils écrivent l'agent / la livraison ; le numéro de lot n'est
-- plus lu par personne) : les écrans n'ont PAS besoin d'être remis en
-- arrière. Après ce retour : plus aucune ligne n'est écrite, et les lignes
-- existantes ne sont plus protégées.
--
-- SI C'EST UNE FONCTION DE LOT QUI CASSE (un écran refuse tout, pas une
-- écriture SQL) : ce bloc n'y change rien. Remettre les pages d'avant, dans
-- le dossier du projet :
--   git checkout 43b2acb -- app/centre-appel/page.js app/assignation-livreur/page.js
-- puis pousser. Les pages d'avant n'appellent aucune fonction de ce fichier.
--
-- Exécutable en entier, deux fois, et même si historique_affectations.sql
-- n'a jamais tourné ou s'est arrêté au milieu.
-- Pour réinstaller : relancer historique_affectations.sql (rejouable).
-- =============================================================================
do $$
begin
  drop trigger if exists trg_historique_agent on public.commandes;
  drop trigger if exists trg_historique_livreur on public.livraisons;
  if to_regclass('public.historique_affectations') is not null then
    drop trigger if exists trg_historique_affectations_garde on public.historique_affectations;
    drop trigger if exists trg_historique_affectations_garde_vider on public.historique_affectations;
  end if;

  if exists (select 1 from pg_trigger
              where tgname in ('trg_historique_agent', 'trg_historique_livreur',
                               'trg_historique_affectations_garde',
                               'trg_historique_affectations_garde_vider')) then
    raise exception 'Retour incomplet : un trigger d''historique des affectations est encore là.';
  end if;
  raise notice 'Retour fait : les quatre triggers sont retirés. Table, lignes, vue et fonctions gardées.';
end $$;
