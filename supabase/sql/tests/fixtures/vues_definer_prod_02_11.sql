-- Lu en PRODUCTION le 02/11/2026 (pg_get_viewdef / pg_get_functiondef / has_table_privilege), recopié tel quel.
-- Les trois vues SECURITY DEFINER signalées par le linter Supabase, les quatre fonctions qu'elles appellent,
-- et les droits de production. Sert à test_vues_definer.mjs : prouver les filtres sur CE qui tourne.

CREATE OR REPLACE FUNCTION public.est_responsable()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in ('admin', 'ceo', 'manager')
$function$;

CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select tenant_id from public.user_roles where user_id = auth.uid() limit 1
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_roles ur
    left join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and (ur.role = 'super_admin' or r.nom = 'super_admin')
  )
$function$;

CREATE OR REPLACE FUNCTION public.mon_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select r.nom from public.user_roles ur
       join public.roles r on r.id = ur.role_id
      where ur.user_id = auth.uid() limit 1),
    (select ur.role from public.user_roles ur where ur.user_id = auth.uid() limit 1)
  )
$function$;


create or replace view public.v_historique_affectations with (security_invoker = off, security_barrier = true) as
 SELECT id,
    tenant_id,
    commande_id,
    commande_id IS NULL AS commande_supprimee,
    commande_lead_id,
    commande_tracking,
    commande_client,
    commande_produit,
    quoi,
    avant_id,
    avant_nom,
    apres_id,
    apres_nom,
    fait_par,
    fait_par_nom,
    via,
    lot_id,
        CASE
            WHEN lot_id IS NOT NULL THEN ( SELECT count(*) AS count
               FROM historique_affectations x
              WHERE x.lot_id = h.lot_id)
            ELSE NULL::bigint
        END AS lot_taille,
    cree_le
   FROM historique_affectations h
  WHERE is_super_admin() OR tenant_id = get_my_tenant_id() AND est_responsable();

create or replace view public.v_historique_statuts with (security_invoker = off, security_barrier = true) as
 SELECT id,
    tenant_id,
    commande_id,
    commande_id IS NULL AS commande_supprimee,
    commande_lead_id,
    commande_tracking,
    commande_client,
    commande_produit,
    statut_precedent,
    statut,
        CASE
            WHEN is_super_admin() OR est_responsable() THEN fait_par
            ELSE NULL::uuid
        END AS fait_par,
        CASE
            WHEN is_super_admin() OR est_responsable() THEN fait_par_nom
            ELSE NULL::text
        END AS fait_par_nom,
    note,
    duree_secondes,
    via,
    cree_le,
    lot_id
   FROM historique_statuts h
  WHERE is_super_admin() OR tenant_id = get_my_tenant_id() AND (est_responsable() OR mon_role() = 'seller'::text AND COALESCE(( SELECT c.vendeur_id
           FROM commandes c
          WHERE c.id = h.commande_id), vendeur_id) = auth.uid());

create or replace view public.v_pays_livrables as
 SELECT DISTINCT p.tenant_id,
    p.id AS pays_id,
    p.nom,
    p.code,
    p.devise
   FROM entrepots e
     JOIN pays p ON p.id = e.pays_id
  WHERE e.pays_id IS NOT NULL AND (is_super_admin() OR p.tenant_id = get_my_tenant_id());

-- Droits lus en production le 02/11
revoke all on public.historique_statuts, public.historique_affectations from anon, authenticated;
grant select on public.historique_statuts, public.historique_affectations to service_role;
revoke all on public.v_historique_statuts, public.v_historique_affectations from anon, authenticated;
grant select on public.v_historique_statuts, public.v_historique_affectations to authenticated;
grant all on public.v_pays_livrables to anon, authenticated, service_role;
