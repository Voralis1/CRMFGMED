-- =============================================================================
-- RELEVÉ VENDEUR : SEULEMENT L'ARGENT QUE LE BUREAU A, AU MONTANT ENCAISSÉ
-- 03/11/2026 — NE MODIFIE AUCUNE DONNÉE. Change une vue (v_commandes_a_regler).
-- =============================================================================
--
-- LE TROU (lu le 03/11). La liste « à régler » (Établir un relevé) ne
-- demandait qu'une chose : commandes.statut_livraison = 'livre'. Donc :
--   1. une commande livrée ce matin était payable au vendeur alors que le
--      livreur avait encore l'argent (paiement en_attente / encaisse, pas
--      remis) — ou ne l'a jamais rendu ;
--   2. le vendeur était payé au PRIX de la commande, même si le livreur a
--      encaissé moins (remise à la porte) ;
--   3. une commande dont le « vendeur » est un manager ou le super admin y
--      figurait (lu le 03/11 : 2 — MAN-MVV3040Y-IFDZ manager 987,
--      MAN-MV9E3CU8-TIFC super admin 0) ;
--   4. elle lisait la COPIE du statut sur la commande, pas la livraison.
--
-- LA RÈGLE (sa décision, 03/11 : le vendeur est payé sur l'argent réellement
-- encaissé). Une commande est « à régler » si :
--   · sa livraison (livraisons.statut) est « livre » ;
--   · son paiement est « remis » (le bureau a l'argent) ;
--   · son vendeur est un VENDEUR (user_roles.role = 'seller') de l'entreprise ;
--   · elle n'est dans aucun relevé (inchangé).
-- Nouvelle colonne en fin de vue : montant_encaisse = paiements.montant. La
-- page s'en sert comme montant de la ligne (repli sur le prix tant que la
-- colonne n'existe pas — l'ordre SQL / mise en ligne de la page est libre).
-- Mêmes colonnes qu'avant, dans le même ordre ; statut_livraison vient
-- maintenant de la livraison. security_invoker reste on (les droits de celui
-- qui lit) ; les droits sur la vue ne changent pas.
--
--   §1 dit quelles commandes QUITTENT la liste, et pourquoi (avis) ;
--   §2 la vue ;
--   §3 vérification : chaque ligne a sa livraison livrée, son paiement remis,
--      un vendeur ; le montant = l'encaissé.
--
-- RETOUR ARRIÈRE : reglement_sur_encaisse_retour.sql (copie sur le Bureau :
-- RETOUR_reglement_sur_encaisse.sql) = la vue lue en prod le 03/11.
-- =============================================================================

begin;

-- §1 Ce qui quitte la liste ------------------------------------------------------
do $$
declare r record; n integer := 0;
begin
  for r in
    select v.lead_id,
           concat_ws(' ; ',
             case when not exists (select 1 from public.livraisons l where l.commande_id = v.commande_id and l.statut = 'livre')
                  then 'livraison pas « livre »' end,
             case when not exists (select 1 from public.paiements p where p.commande_id = v.commande_id and p.statut = 'remis')
                  then 'argent pas encore remis au bureau' end,
             case when not exists (select 1 from public.user_roles u where u.user_id = v.vendeur_id
                                     and u.tenant_id = v.tenant_id and lower(u.role) = 'seller')
                  then 'le « vendeur » n''est pas un vendeur' end) as raison
      from public.v_commandes_a_regler v
  loop
    if r.raison <> '' then
      n := n + 1;
      raise notice 'quitte la liste à régler : % — %', r.lead_id, r.raison;
    end if;
  end loop;
  raise notice 'reglement_sur_encaisse.sql : % commande(s) quittent la liste à régler.', n;
end $$;

-- §2 La vue -----------------------------------------------------------------------
create or replace view public.v_commandes_a_regler
with (security_invoker = on) as
select c.id                              as commande_id,
       c.tenant_id,
       c.vendeur_id,
       c.lead_id,
       c.client_nom,
       c.produit,
       coalesce(c.quantite, 1)           as quantite,
       coalesce(c.prix, 0::numeric)      as prix,
       l.statut                          as statut_livraison,   -- la livraison, plus la copie sur la commande
       c.updated_at,
       c.created_at,
       pa.devise,
       p.montant                         as montant_encaisse    -- ce que le livreur a réellement encaissé
  from public.commandes c
  join public.paiements p   on p.commande_id = c.id and p.statut = 'remis'
  join lateral (select 'livre'::text as statut
                  from public.livraisons l
                 where l.commande_id = c.id and l.statut = 'livre'
                 limit 1) l on true
  left join public.pays pa  on pa.id = c.pays_id
 where c.vendeur_id is not null
   and exists (select 1 from public.user_roles u
                where u.user_id = c.vendeur_id and u.tenant_id = c.tenant_id and lower(u.role) = 'seller')
   and not exists (select 1 from public.reglements_commandes rc where rc.commande_id = c.id);

comment on view public.v_commandes_a_regler is
  'fichier: reglement_sur_encaisse.sql — à régler = livrée + argent remis au bureau + vendeur réel + dans aucun relevé ; montant_encaisse = paiements.montant.';

-- §3 Vérification ------------------------------------------------------------------
do $$
declare n integer;
begin
  if coalesce((select array_to_string(reloptions, ',') from pg_class
                where oid = 'public.v_commandes_a_regler'::regclass), '') not like '%security_invoker=on%' then
    raise exception 'reglement_sur_encaisse.sql : la vue n''est plus security_invoker. Rien n''est changé.';
  end if;
  select count(*) into n
    from public.v_commandes_a_regler v
   where not exists (select 1 from public.paiements p where p.commande_id = v.commande_id and p.statut = 'remis')
      or not exists (select 1 from public.livraisons l where l.commande_id = v.commande_id and l.statut = 'livre')
      or v.montant_encaisse is distinct from (select p.montant from public.paiements p where p.commande_id = v.commande_id);
  if n > 0 then
    raise exception 'reglement_sur_encaisse.sql : % ligne(s) de la vue ne respectent pas la règle. Rien n''est changé.', n;
  end if;
  raise notice 'reglement_sur_encaisse.sql : à régler = livrée + argent remis + vendeur réel ; montant = l''encaissé. % commande(s) à régler.',
    (select count(*) from public.v_commandes_a_regler);
end $$;

commit;

-- Ce qui est à régler maintenant
select lead_id, prix, montant_encaisse, devise from public.v_commandes_a_regler order by updated_at;
