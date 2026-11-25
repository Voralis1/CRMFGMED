-- =============================================================================
-- `appels` : lisible par les responsables seulement — 28/10/2026
-- =============================================================================
--
-- LA SEULE DÉFINITION des politiques de `appels`. Les changer ICI, jamais
-- dans un second fichier : un autre fichier qui les recréerait les remettrait
-- dans un état ancien à chaque relance (identifiants_api.sql,
-- entrepot_commande.sql, correctif_urgent_14_10.sql l'ont fait). Ce qui en
-- dépend ne les recrée pas, il les VÉRIFIE (renvoyer_en_attente.sql §1
-- refuse de s'installer si la table est plus ouverte que ceci).
--
-- AVANT : un agent lisait les appels de ses leads et tous ceux sans agent ;
-- tout autre compte de l'entreprise (vendeur, livreur) lisait chaque appel
-- SANS agent de TOUTE l'entreprise, commandes des autres vendeurs comprises
-- (statut + commentaire). Relevé le 28/10, test company : seller2 lisait 87
-- appels, les 87 sur des commandes qui ne sont pas les siennes. Même famille
-- que le vendeur qui voyait les produits d'un autre.
--
-- APRÈS :
--   lecture       : manager, admin, ceo de l'entreprise, super_admin ;
--   écriture      : manager, admin, super_admin (gere_la_config) — le ceo
--                   lit tout et n'écrit rien. Aucun écran n'écrit `appels`
--                   (confirmer-appel passe par la clé service) ;
--   tous les autres (vendeur, agent, livreur, sans rôle) : rien. Pour
--   l'agent, c'est ce qui garantit la vue du Centre d'appel (F) : rien ne lui
--   dit qu'un lead a déjà été essayé, pas même la console du navigateur.
-- Le vendeur lit l'histoire de SES commandes par v_historique_statuts, sans
-- nom d'agent.
--
-- Ce qui change à l'écran : rien.
--   · vendeur : son tableau de bord n'affiche aucun chiffre d'appel (masqué
--     pour lui) ; stats_dashboard, qui lit `appels` avec ses droits, lui
--     renvoie désormais 0 dans les données qu'il ne voit pas ;
--   · livreur : Livraisons et Profil ne lisent pas `appels` ; ses actions
--     passent par des fonctions Edge (clé service) ;
--   · agent : son panneau ne lit plus les appels (pages du 28/10).
--
-- Il ne modifie AUCUNE ligne. Exécutable en entier, et deux fois.
--
-- À lancer AVANT renvoyer_en_attente.sql, qui refuse de s'installer sans lui.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Les politiques
-- -----------------------------------------------------------------------------
-- Toutes retirées d'abord : des politiques PERMISSIVES s'additionnent.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'appels'
  loop
    execute format('drop policy %I on public.appels', p.policyname);
  end loop;
end $$;

create policy appels_select on public.appels
  for select to authenticated
  using (public.is_super_admin()
         or (tenant_id = public.get_my_tenant_id() and public.est_responsable()));

create policy appels_insert on public.appels
  for insert to authenticated
  with check (tenant_id = public.get_my_tenant_id() and public.gere_la_config()
              or public.is_super_admin());

create policy appels_update on public.appels
  for update to authenticated
  using (tenant_id = public.get_my_tenant_id() and public.gere_la_config()
         or public.is_super_admin())
  with check (tenant_id = public.get_my_tenant_id() and public.gere_la_config()
              or public.is_super_admin());

create policy appels_delete on public.appels
  for delete to authenticated
  using (tenant_id = public.get_my_tenant_id() and public.gere_la_config()
         or public.is_super_admin());


-- -----------------------------------------------------------------------------
-- 2. Vérification
-- -----------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from pg_policies where schemaname = 'public' and tablename = 'appels';
  if v_n <> 4 then
    raise exception 'appels : % politique(s) au lieu de 4.', v_n;
  end if;
  -- Plus aucune branche « par agent » ou « sans agent » : c'est elle qui
  -- laissait passer vendeurs et livreurs.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'appels'
                and (coalesce(qual, '') ilike '%agent_id%' or coalesce(with_check, '') ilike '%agent_id%'
                     or coalesce(qual, '') ilike '%mon_role%')) then
    raise exception 'appels : une politique ouvre encore la table par agent_id ou par rôle.';
  end if;
  raise notice 'appels_responsables.sql : appels lisible par manager, admin, ceo, super_admin seulement. Aucune ligne modifiée.';
end $$;
