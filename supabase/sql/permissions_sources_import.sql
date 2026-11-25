-- =============================================================================
-- Permissions du module « Sources d'import » — 15/10/2026
-- Rejouable : on peut exécuter tout le fichier plusieurs fois sans risque.
--
-- Pourquoi ce fichier : l'écran /sources-import revient dans le menu, et il
-- lit trois permissions. Le SQL qui les avait créées (07/10) n'est pas dans le
-- dépôt. Ce fichier les recrée si une base ne les a pas ; sur la base de
-- production elles existent déjà (vérifié le 15/10, voir §2).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. État actuel (lecture seule) — à lire AVANT de regarder la suite
--
-- Une ligne par rôle, une colonne par permission. Tous les rôles sont listés,
-- super_admin compris : hasPermission() n'a AUCUN passe-droit pour lui, il ne
-- voit le menu que si son rôle a la ligne.
-- -----------------------------------------------------------------------------
select r.nom as role,
       coalesce(bool_or(rp.permission_code = 'menu_sources_import'), false)  as menu_sources_import,
       coalesce(bool_or(rp.permission_code = 'gerer_sources_import'), false) as gerer_sources_import,
       coalesce(bool_or(rp.permission_code = 'gerer_mes_sources'), false)    as gerer_mes_sources
  from public.roles r
  left join public.role_permissions rp on rp.role_id = r.id
 group by r.id, r.nom
 order by r.nom;


-- -----------------------------------------------------------------------------
-- 1. Les permissions elles-mêmes
--
-- on conflict do nothing : si elles existent déjà, leur nom et leur
-- description restent ceux d'origine.
-- -----------------------------------------------------------------------------
insert into public.permissions (code, nom, module, description) values
  ('menu_sources_import',  'Menu Sources d''import',          'Administration',
   'Voir l''écran des sources d''import'),
  ('gerer_sources_import', 'Gérer toutes les sources',        'Administration',
   'Créer, couper et régénérer les sources de toute l''entreprise'),
  ('gerer_mes_sources',    'Gérer mes sources',               'Administration',
   'Créer, couper et régénérer ses propres sources (vendeur)')
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- 2. Attribution aux rôles — UNIQUEMENT à la première installation
--
-- Pour chaque permission, on n'attribue rien si un rôle l'a déjà : sinon,
-- rejouer ce fichier remettrait un droit retiré exprès depuis
-- /super-admin/roles.
--
-- ATTENTION — ce que ce bloc NE FAIT PAS : si la permission existe et qu'UN
-- SEUL rôle l'a déjà, il n'ajoute RIEN, même si d'autres rôles de la liste
-- ci-dessous la devraient. Les rôles manquants se règlent à la main dans
-- /super-admin/roles, en comparant avec le résultat du §0. Avoir exécuté ce
-- fichier ne prouve pas que la répartition est complète.
--
-- État vérifié le 15/10 : les trois permissions existent et sont attribuées,
-- ce bloc n'ajoutera donc rien. Une anomalie à corriger À LA MAIN :
-- seller détient `gerer_sources_import` (« toutes les sources »). L'écran lui
-- propose alors de choisir n'importe quel vendeur ; la base le refuse depuis
-- rls_sources_import.sql, mais le droit n'a rien à faire là.
--
-- Répartition proposée, calquée sur la RLS de sources_import (responsable =
-- toute l'entreprise, vendeur = ses sources) :
--   menu_sources_import  : seller, manager, admin, ceo, super_admin
--   gerer_sources_import : manager, admin, super_admin   (le ceo lit, n'écrit pas)
--   gerer_mes_sources    : seller
-- -----------------------------------------------------------------------------
do $$
declare
  v_regle record;
begin
  for v_regle in
    select * from (values
      ('menu_sources_import',  array['seller','manager','admin','ceo','super_admin']),
      ('gerer_sources_import', array['manager','admin','super_admin']),
      ('gerer_mes_sources',    array['seller'])
    ) as t(code, roles)
  loop
    if not exists (select 1 from public.role_permissions where permission_code = v_regle.code) then
      insert into public.role_permissions (role_id, permission_code)
      select r.id, v_regle.code
        from public.roles r
       where r.nom = any (v_regle.roles)
      on conflict do nothing;
    end if;
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Vérification (lecture seule) : même grille qu'au §0, à comparer
-- -----------------------------------------------------------------------------
select r.nom as role,
       coalesce(bool_or(rp.permission_code = 'menu_sources_import'), false)  as menu_sources_import,
       coalesce(bool_or(rp.permission_code = 'gerer_sources_import'), false) as gerer_sources_import,
       coalesce(bool_or(rp.permission_code = 'gerer_mes_sources'), false)    as gerer_mes_sources
  from public.roles r
  left join public.role_permissions rp on rp.role_id = r.id
 group by r.id, r.nom
 order by r.nom;
