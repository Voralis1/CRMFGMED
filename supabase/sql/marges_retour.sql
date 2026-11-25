-- =============================================================================
-- RETOUR ARRIÈRE de marges.sql — 12/11/2026 (sa décision : tout retirer, garder un simulateur)
-- Retire les 2 calculs, les 3 tables de coûts (LES COÛTS SAISIS SONT PERDUS — lu le
-- 12/11 : 1 ligne, dans l'entreprise de test), les fonctions et le trigger statut_le,
-- et la colonne livraisons.statut_le (vide le 12/11 : 0 / 15 ; rien d'autre ne la lit).
-- GARDE la permission voir_marges, RENOMMÉE « Simulateur de rentabilité » : le
-- simulateur (page seule, rien d'enregistré) la lit ; admin + super admin, modifiable
-- dans Rôles. Rejouable.
-- =============================================================================
begin;
drop function if exists public.marge_fgmed(uuid, date, date);
drop function if exists public.marge_produits(uuid, date, date);
drop function if exists public.marges_livrees(uuid, date, date);
drop function if exists public.cout_fgmed_applicable(uuid, uuid, date);
drop function if exists public.peut_voir_marges(uuid);
drop table if exists public.couts_fgmed;
drop table if exists public.couts_fixes;
drop table if exists public.couts_produits;
drop function if exists public.couts_meme_entreprise();
drop trigger if exists trg_ab_livraison_statut_le on public.livraisons;
drop function if exists public.livraison_statut_le();
alter table public.livraisons drop column if exists statut_le;

-- la permission reste, pour le simulateur
update public.permissions
   set nom = 'Simulateur de rentabilité',
       description = 'Calculer si un produit gagne de l''argent avant de le vendre (rien n''est enregistré). Admin et super admin'
 where code = 'voir_marges';

do $$ begin
  raise notice 'marges_retour.sql : marges, coûts et statut_le retirés ; voir_marges gardée (« Simulateur de rentabilité »).';
end $$;
commit;

-- Ce qui reste
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
         and proname in ('marge_fgmed','marge_produits','marges_livrees','cout_fgmed_applicable','peut_voir_marges','couts_meme_entreprise','livraison_statut_le')) as fonctions_restantes,
       (select count(*) from information_schema.tables where table_schema = 'public'
         and table_name in ('couts_fgmed','couts_fixes','couts_produits'))                   as tables_restantes,
       (select count(*) from information_schema.columns where table_schema = 'public'
         and table_name = 'livraisons' and column_name = 'statut_le')                         as colonne_statut_le,
       (select nom || ' → ' || coalesce((select string_agg(r.nom, ', ' order by r.nom) from public.role_permissions rp
                 join public.roles r on r.id = rp.role_id where rp.permission_code = 'voir_marges'), 'personne')
          from public.permissions where code = 'voir_marges')                                 as permission;
