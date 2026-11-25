-- =============================================================================
-- RETOUR ARRIÈRE de frais_vendeurs.sql — 05/11/2026
-- =============================================================================
-- ⚠ D'ABORD reglement_atomique_retour_05_11.sql (etablir_releve se sert de
-- tarif_applicable). Retire la table des frais, la règle et la saisie des
-- charges. Les COLONNES ajoutées aux relevés restent (elles portent les frais
-- des relevés déjà établis — les effacer effacerait ce qui a été payé).
-- Rejouable.
-- =============================================================================
begin;
drop function if exists public.fixer_charges_releve(uuid, numeric, text);
drop function if exists public.tarif_applicable(uuid, uuid, uuid, date);
drop table if exists public.tarifs_vendeurs;
drop function if exists public.tarifs_vendeurs_garde();
commit;
select to_regclass('public.tarifs_vendeurs') as table_restante;
