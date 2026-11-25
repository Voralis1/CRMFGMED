-- =============================================================================
-- RELEVÉ VENDEUR EN UNE SEULE ÉTAPE, TOTAL CALCULÉ PAR LA BASE, PAYÉ = FIGÉ
-- 03/11/2026 — NE MODIFIE AUCUN RELEVÉ EXISTANT. À lancer APRÈS reglement_sur_encaisse.sql.
-- =============================================================================
--
-- LES TROUS (lus le 03/11) :
--   1. La page créait le relevé (avec son TOTAL) puis, dans une 2e requête, ses
--      commandes. 2e requête ratée (réseau, onglet fermé, DOUBLE CLIC : la 2e
--      tombe sur la clé de reglements_commandes) → un relevé avec un total et
--      AUCUNE commande ; ses commandes restaient « à régler » et pouvaient
--      entrer dans un autre relevé → vendeur payé deux fois.
--   2. Le total était écrit par le navigateur ; rien ne vérifiait qu'il égale
--      la somme des commandes (et il restait modifiable tant que non payé).
--   3. Un relevé « payé » pouvait repasser « en attente » (la garde bloquait
--      les montants, pas le statut) → puis vidé, supprimé, ses commandes
--      redevenaient « à régler ».
-- (Lu le 03/11 : les 5 relevés existants sont sains — total = leurs lignes.)
--
-- CE QUE FAIT LE FICHIER :
--   §1 prérequis : la vue « à régler » de reglement_sur_encaisse.sql ;
--   §2 etablir_releve(entreprise, vendeur, commandes[], méthode, début, fin) —
--      LA porte, UNE transaction : droit « gerer_reglements » dans l'entreprise
--      (aujourd'hui manager, admin, super admin) ; chaque commande verrouillée
--      puis vérifiée (de l'entreprise, de CE vendeur, livraison livrée, argent
--      remis, dans aucun relevé) — sinon refus qui NOMME la commande et la
--      raison ; une seule devise ; le vendeur est un vendeur ; le TOTAL et
--      chaque ligne = ce que le livreur a encaissé (paiements.montant), calculés
--      ici. Renvoie l'id, la référence, le nombre, le total.
--   §3 garde des relevés (nouveau corps de reglements_garde) : pour un compte
--      de l'application, un relevé payé ne change PLUS DU TOUT (statut compris) ;
--      sur un relevé non payé, seuls statut, méthode, note, date de paiement
--      changent — jamais le vendeur, les montants, le nombre, la période, la
--      devise. (Éditeur SQL / clé service : non contrôlés, comme avant.)
--   §4 l'ancienne porte se ferme : le navigateur ne crée plus de relevé ni n'y
--      ajoute/retire de commande directement (politiques insert/delete
--      retirées, droits insert/update/delete/truncate retirés à authenticated
--      sur reglements_commandes, insert/truncate sur reglements). La lecture,
--      « Marquer payé » et la suppression d'un relevé NON payé restent.
--   §5 répétition (annulée), sous le compte d'un manager. Un échec → rien.
--
-- ORDRE : ce fichier ET la page app/components/paiements/ReglementsVendeurs.js
-- le même jour. Entre les deux, l'ANCIENNE page ne peut plus créer de relevé
-- (erreur affichée, rien de créé) — sûr, mais bloqué.
-- RETOUR ARRIÈRE : reglement_atomique_retour.sql (copie sur le Bureau :
-- RETOUR_reglement_atomique.sql).
--
-- 05/11 — LES FRAIS DE CHAQUE LEAD (sa décision, frais_vendeurs.sql à lancer
-- AVANT) : à l'établissement, chaque ligne reçoit les frais valables le JOUR
-- DE SA LIVRAISON (tarif du vendeur, sinon du pays) : frais commande +
-- livraison + upsell × (quantité − 1), et son NET = total − ces frais. Le
-- relevé additionne : total des ventes, frais commande, livraison, upsell,
-- net à payer (charges = 0 à l'établissement ; fixer_charges_releve les
-- saisit ensuite). Pas de frais saisis pour le pays → relevé refusé, avec le
-- nom du pays. La garde laisse fixer_charges_releve (crm.reglement_calcul)
-- recalculer un relevé NON payé ; rien d'autre ne touche ses montants.
-- Retour à la version du 03/11 (sans frais) : reglement_atomique_retour_05_11.sql.
--
-- 09/11 — LE BAS DU RELEVÉ (retenues_releve.sql à lancer AVANT) : à
-- l'établissement, le % de transfert du jour est copié sur le relevé, puis
-- recalculer_releve fait l'en-tête (crédit d'expédition, ajustements,
-- transfert : 0 au départ). La garde fige aussi ces nouvelles colonnes ; seules
-- les portes de retenues_releve.sql les changent, avant « payé ».
-- Même jour : la garde écrit paye_par (qui a marqué payé) et le fige.
-- 11/11 : sur un relevé payé, seul taux_mad (équivalent MAD, pour information) change encore.
-- Retour à la version du 05/11 : reglement_atomique_retour_09_11.sql.
-- =============================================================================

begin;

-- §1 Prérequis -----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'v_commandes_a_regler' and column_name = 'montant_encaisse') then
    raise exception 'reglement_atomique.sql : lancez reglement_sur_encaisse.sql d''abord (la vue « à régler » sur l''argent remis). Rien n''est installé.';
  end if;
  if to_regprocedure('public.a_la_permission(text)') is null then
    raise exception 'reglement_atomique.sql : a_la_permission(text) absente. Rien n''est installé.';
  end if;
  if to_regprocedure('public.tarif_applicable(uuid, uuid, uuid, date)') is null then
    raise exception 'reglement_atomique.sql : lancez frais_vendeurs.sql d''abord (les frais par lead). Rien n''est installé.';
  end if;
  if to_regprocedure('public.recalculer_releve(uuid)') is null then
    raise exception 'reglement_atomique.sql : lancez retenues_releve.sql d''abord (crédit d''expédition, ajustements, transfert). Rien n''est installé.';
  end if;
end $$;

-- §2 La porte ------------------------------------------------------------------
create or replace function public.etablir_releve(
  p_tenant uuid, p_vendeur uuid, p_commandes uuid[], p_methode text, p_debut date, p_fin date)
returns table (reglement_id uuid, reference text, nb_commandes integer, total numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_ids      uuid[];
  v_refus    text;
  v_devises  text[];
  v_debut    date;
  v_fin      date;
  v_total    numeric;
  v_nb       integer;
  v_id       uuid;
  v_ref      text;
  v_sans_tarif text;
begin
  if not (public.is_super_admin()
          or (p_tenant = public.get_my_tenant_id() and public.a_la_permission('gerer_reglements'))) then
    raise exception 'Votre rôle ne permet pas d''établir un relevé.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_commandes, '{}')) x where x is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'Aucune commande retenue.';
  end if;
  if not exists (select 1 from public.user_roles u
                  where u.user_id = p_vendeur and u.tenant_id = p_tenant and lower(u.role) = 'seller') then
    raise exception 'Ce compte n''est pas un vendeur de cette entreprise.';
  end if;

  -- Verrou : deux relevés lancés en même temps sur les mêmes commandes passent
  -- l'un après l'autre ; le second voit alors qu'elles sont prises.
  perform 1 from public.commandes c where c.id = any (v_ids) order by c.id for update;

  -- Chaque commande, avec la raison de son refus.
  select string_agg(coalesce(c.lead_id, x.id::text) || ' : ' || x.raison, ' ; ' order by x.raison, c.lead_id)
    into v_refus
    from (select i.id,
                 case
                   when c.id is null                          then 'introuvable'
                   when c.tenant_id <> p_tenant               then 'd''une autre entreprise'
                   when c.vendeur_id is distinct from p_vendeur then 'd''un autre vendeur'
                   when exists (select 1 from public.reglements_commandes rc where rc.commande_id = c.id)
                                                              then 'déjà dans un relevé'
                   when not exists (select 1 from public.livraisons l where l.commande_id = c.id and l.statut = 'livre')
                                                              then 'pas livrée'
                   when not exists (select 1 from public.paiements p where p.commande_id = c.id and p.statut = 'remis')
                                                              then 'argent pas encore remis au bureau'
                 end as raison
            from unnest(v_ids) i(id)
            left join public.commandes c on c.id = i.id) x
    left join public.commandes c on c.id = x.id
   where x.raison is not null;
  if v_refus is not null then
    raise exception 'Relevé refusé — % : %', (select count(*) from unnest(string_to_array(v_refus, ' ; '))), left(v_refus, 1500);
  end if;

  select array_agg(distinct coalesce(pa.devise, '—')) into v_devises
    from public.commandes c left join public.pays pa on pa.id = c.pays_id
   where c.id = any (v_ids);
  if cardinality(v_devises) > 1 then
    raise exception 'Ces commandes sont en % : faites un relevé par devise.', array_to_string(v_devises, ' et ');
  end if;

  select count(*), coalesce(sum(p.montant), 0), min(c.updated_at)::date, max(c.updated_at)::date
    into v_nb, v_total, v_debut, v_fin
    from public.commandes c join public.paiements p on p.commande_id = c.id
   where c.id = any (v_ids);
  v_debut := coalesce(p_debut, v_debut, current_date);
  v_fin   := coalesce(p_fin, v_fin, current_date);
  if v_fin < v_debut then
    raise exception 'La fin de la période (%) est avant son début (%).', v_fin, v_debut;
  end if;

  -- 05/11 : des frais saisis pour chaque pays, à la date de chaque livraison.
  select string_agg(distinct coalesce(pa.nom, '?'), ', ') into v_sans_tarif
    from public.commandes c left join public.pays pa on pa.id = c.pays_id
   where c.id = any (v_ids)
     and not exists (select 1 from public.tarif_applicable(p_tenant, c.pays_id, p_vendeur,
                       (select max(l.date_livraison)::date from public.livraisons l
                         where l.commande_id = c.id and l.statut = 'livre')));
  if v_sans_tarif is not null then
    raise exception 'Aucun frais vendeur saisi pour % (à la date de livraison) : entrez-les dans Paramètres → Frais vendeurs.', v_sans_tarif;
  end if;

  insert into public.reglements (tenant_id, vendeur_id, periode_debut, periode_fin, methode, devise,
                                 nb_commandes, total_ventes, net_a_payer, cree_par)
  values (p_tenant, p_vendeur, v_debut, v_fin, coalesce(p_methode, 'especes'),
          nullif(v_devises[1], '—'), v_nb, 0, 0, auth.uid())
  returning id, reglements.reference into v_id, v_ref;

  -- Chaque ligne : le total (l'encaissé), la quantité, les frais du jour de
  -- la livraison, le net. COPIÉS ici : un tarif changé plus tard ne change
  -- jamais ce relevé.
  insert into public.reglements_commandes (commande_id, reglement_id, tenant_id, montant,
                                           quantite, total_commande, frais_commande, frais_livraison, frais_upsell, net)
  select c.id, v_id, p_tenant, p.montant,
         qq.q, p.montant, t.frais_commande, t.frais_livraison, t.frais_upsell_unite * (qq.q - 1),
         p.montant - t.frais_commande - t.frais_livraison - t.frais_upsell_unite * (qq.q - 1)
    from public.commandes c
    join public.paiements p on p.commande_id = c.id
    cross join lateral (select greatest(coalesce(c.quantite, 1), 1) as q) qq
    cross join lateral public.tarif_applicable(p_tenant, c.pays_id, p_vendeur,
                 (select max(l.date_livraison)::date from public.livraisons l
                   where l.commande_id = c.id and l.statut = 'livre')) t
   where c.id = any (v_ids);

  -- L'en-tête = la somme de ses lignes, calculée ici (charges : 0 pour l'instant).
  perform set_config('crm.reglement_calcul', 'oui', true);
  update public.reglements r
     set total_ventes       = x.total,
         frais_confirmation = x.fc,
         frais_livraison    = x.fl,
         frais_upsell       = x.fu,
         net_a_payer        = x.net
    from (select coalesce(sum(total_commande), 0) total, coalesce(sum(frais_commande), 0) fc,
                 coalesce(sum(frais_livraison), 0) fl, coalesce(sum(frais_upsell), 0) fu, coalesce(sum(net), 0) net
            from public.reglements_commandes where reglement_id = v_id) x
   where r.id = v_id;
  -- 09/11 : le % de transfert du jour (pays le plus présent du relevé), COPIÉ ;
  -- puis l'en-tête complet (crédit, ajustements, transfert) par recalculer_releve.
  update public.reglements r
     set frais_transfert_pct = public.transfert_applicable(p_tenant,
           (select c.pays_id from public.commandes c where c.id = any (v_ids) and c.pays_id is not null
             group by c.pays_id order by count(*) desc, c.pays_id limit 1),
           p_vendeur, current_date)
   where r.id = v_id;
  perform set_config('crm.reglement_calcul', '', true);
  perform public.recalculer_releve(v_id);

  return query select v_id, v_ref, v_nb, v_total;
end;
$$;
revoke all on function public.etablir_releve(uuid, uuid, uuid[], text, date, date) from public, anon;
grant execute on function public.etablir_releve(uuid, uuid, uuid[], text, date, date) to authenticated, service_role;
comment on function public.etablir_releve(uuid, uuid, uuid[], text, date, date) is 'fichier: reglement_atomique.sql';

-- §3 La garde des relevés ---------------------------------------------------------
-- 09/11 (sa décision) : « Marquer payé » = la validation, réservée à l'ADMIN et au
-- SUPER ADMIN ; le manager établit les relevés mais ne les paie pas. Une
-- permission comme les autres (« payer_reglements », modifiable dans Rôles) :
-- donnée à l'admin à la CRÉATION de la permission seulement — rejouer le fichier
-- ne la redonne pas si elle a été décochée. Le super admin la reçoit seul
-- (trg_permission_au_super_admin, roles_permissions_garde.sql).
do $$
begin
  if not exists (select 1 from public.permissions where code = 'payer_reglements') then
    insert into public.permissions (code, nom, module, description)
    values ('payer_reglements', 'Marquer un relevé payé', 'Finance',
            'Valider un relevé vendeur en le marquant payé (après cela il ne change plus)');
    insert into public.role_permissions (role_id, permission_code)
    select r.id, 'payer_reglements' from public.roles r
     where r.nom in ('admin', 'super_admin') and r.tenant_id is null
    on conflict do nothing;
  end if;
end $$;
-- 09/11 (sa décision) : QUI a marqué le relevé payé — écrit par la garde au
-- passage à « payé », jamais tapé. Le créateur, lui, est cree_par (03/11).
alter table public.reglements add column if not exists paye_par uuid;

create or replace function public.reglements_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;   -- service_role, éditeur SQL : personne à contrôler
  end if;

  -- 05/11 : le calcul de la base (etablir_releve, fixer_charges_releve) recalcule
  -- les montants d'un relevé NON payé. Ce réglage ne se pose pas depuis un navigateur.
  if tg_op = 'UPDATE' and old.statut <> 'paye'
     and coalesce(current_setting('crm.reglement_calcul', true), '') = 'oui' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Payé = figé : rien ne change, le statut non plus (sinon on le rouvre,
    -- on le vide, on le supprime, et ses commandes repassent « à régler »).
    -- 11/11 (sa décision) : le taux MAD n'est qu'un équivalent pour information —
    -- il ne change aucun montant : il reste modifiable sur un relevé payé.
    if old.statut = 'paye' and (to_jsonb(new) - 'taux_mad') is distinct from (to_jsonb(old) - 'taux_mad') then
      raise exception 'Ce relevé est déjà payé : il ne peut plus changer.';
    end if;
    -- Non payé : ce que le relevé AFFIRME (vendeur, commandes, montants,
    -- période, devise) se calcule à l'établissement (etablir_releve), jamais
    -- à la main.
    if new.tenant_id      is distinct from old.tenant_id
       or new.reference   is distinct from old.reference
       or new.vendeur_id  is distinct from old.vendeur_id
       or new.nb_commandes is distinct from old.nb_commandes
       or new.total_ventes is distinct from old.total_ventes
       or new.net_a_payer  is distinct from old.net_a_payer
       or new.frais_confirmation is distinct from old.frais_confirmation
       or new.frais_livraison    is distinct from old.frais_livraison
       or new.frais_service      is distinct from old.frais_service
       or new.frais_divers       is distinct from old.frais_divers
       or new.frais_upsell       is distinct from old.frais_upsell
       or new.frais_divers_note  is distinct from old.frais_divers_note
       or new.credit_expedition         is distinct from old.credit_expedition
       or new.credit_expedition_note    is distinct from old.credit_expedition_note
       or new.credit_expedition_poids   is distinct from old.credit_expedition_poids
       or new.credit_expedition_prix_kg is distinct from old.credit_expedition_prix_kg
       or new.credit_expedition_date    is distinct from old.credit_expedition_date
       or new.paye_par      is distinct from old.paye_par
       or new.frais_transfert_pct is distinct from old.frais_transfert_pct
       or new.frais_transfert     is distinct from old.frais_transfert
       or new.periode_debut is distinct from old.periode_debut
       or new.periode_fin   is distinct from old.periode_fin
       or new.devise        is distinct from old.devise
       or new.cree_par      is distinct from old.cree_par
       or new.created_at    is distinct from old.created_at then
      raise exception 'Le vendeur, les montants, la période et la devise d''un relevé se calculent à son établissement : ils ne se modifient pas.';
    end if;
    if new.statut = 'paye' and old.statut <> 'paye'
       and not (public.is_super_admin() or public.a_la_permission('payer_reglements')) then
      raise exception 'Seul un admin peut marquer un relevé payé.' using errcode = '42501';
    end if;
    if new.statut = 'paye' and old.statut <> 'paye' and new.date_paiement is null then
      new.date_paiement := now();
    end if;
    if new.statut = 'paye' and old.statut <> 'paye' then
      new.paye_par := auth.uid();
    end if;
  end if;

  return new;
end;
$$;
comment on function public.reglements_garde() is 'fichier: reglement_atomique.sql';

-- §4 L'ancienne porte se ferme ----------------------------------------------------
drop policy if exists reglements_insert            on public.reglements;
drop policy if exists reglements_commandes_insert  on public.reglements_commandes;
drop policy if exists reglements_commandes_delete  on public.reglements_commandes;
revoke insert, truncate on public.reglements from anon, authenticated;
revoke insert, update, delete, truncate on public.reglements_commandes from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reglements' and cmd = 'INSERT')
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reglements_commandes' and cmd <> 'SELECT') then
    raise exception 'reglement_atomique.sql : une politique d''écriture directe reste. Rien n''est installé.';
  end if;
  if has_table_privilege('authenticated', 'public.reglements', 'insert')
     or has_table_privilege('authenticated', 'public.reglements_commandes', 'insert')
     or has_table_privilege('authenticated', 'public.reglements_commandes', 'delete') then
    raise exception 'reglement_atomique.sql : authenticated écrit encore directement (un GRANT à PUBLIC ?). Rien n''est installé.';
  end if;
end $$;

-- §5 Répétition (annulée), sous le compte d'un manager ------------------------------
do $$
declare
  v_mgr uuid; v_t uuid; v_vend uuid; v_ids uuid[]; r record; v_reg uuid; v_paye uuid; v_adm uuid;
  v_msg text; v_etape text := 'préparation'; v_refus boolean; n integer;
begin
  -- un vendeur qui a des commandes « à régler », et un manager de son entreprise
  select v.tenant_id, v.vendeur_id into v_t, v_vend from public.v_commandes_a_regler v
   order by (v.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc limit 1;
  if v_t is null then
    raise notice 'Répétition partielle : aucune commande à régler aujourd''hui (rien à mettre dans un relevé).';
  end if;
  select u.user_id into v_mgr from public.user_roles u
   where lower(u.role) = 'manager' and (v_t is null or u.tenant_id = v_t) order by u.created_at limit 1;
  if v_mgr is null then
    raise exception 'reglement_atomique.sql : aucun manager pour la répétition. Rien n''est installé.';
  end if;
  if v_t is null then select tenant_id into v_t from public.user_roles where user_id = v_mgr; end if;
  select id into v_paye from public.reglements where tenant_id = v_t and statut = 'paye' limit 1;
  -- 09/11 : qui paie dans la répétition (lu avant de prendre le rôle du manager)
  select u.user_id into v_adm from public.user_roles u
   where (lower(u.role) = 'admin' and u.tenant_id = v_t) or lower(u.role) = 'super_admin'
   order by (lower(u.role) = 'admin') desc, u.created_at limit 1;

  begin
    -- 05/11 : un tarif de répétition (1 000 / 12 000 / 1 500) du PAYS, valable depuis
    -- 2000, pour les pays qui n'ont pas de ligne « Tous les vendeurs » assez ancienne —
    -- annulé avec le reste. (09/11 : une ligne d'un SEUL vendeur ne suffit pas, la
    -- répétition peut prendre un autre vendeur ou une livraison d'avant sa date.)
    insert into public.tarifs_vendeurs (tenant_id, pays_id, vendeur_id, frais_commande, frais_livraison, frais_upsell_unite, valide_depuis)
    select v_t, pa.id, null, 1000, 12000, 1500, date '2000-01-01'
      from public.pays pa
     where pa.tenant_id = v_t
       and not exists (select 1 from public.tarifs_vendeurs tv where tv.tenant_id = v_t and tv.pays_id = pa.id
                        and tv.vendeur_id is null and tv.valide_depuis <= date '2000-01-01');
    perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    v_etape := 'le navigateur ne crée plus de relevé directement';
    v_refus := false;
    begin
      insert into public.reglements (tenant_id, vendeur_id, periode_debut, periode_fin, total_ventes, net_a_payer)
      values (v_t, coalesce(v_vend, v_mgr), current_date, current_date, 999, 999);
    exception when insufficient_privilege then v_refus := true;
    end;
    if not v_refus then raise exception 'un relevé se crée encore directement depuis le navigateur'; end if;

    if v_paye is not null then
      v_etape := 'un relevé payé ne se rouvre pas';
      v_refus := false;
      begin update public.reglements set statut = 'en_attente' where id = v_paye;
      exception when others then v_refus := sqlerrm like '%déjà payé%';
      end;
      if not v_refus then raise exception 'un relevé payé repasse « en attente »'; end if;
    end if;

    if v_vend is not null then
      select array_agg(commande_id) into v_ids from public.v_commandes_a_regler where vendeur_id = v_vend and tenant_id = v_t;
      -- une seule devise pour la répétition
      select array_agg(commande_id) into v_ids from public.v_commandes_a_regler
       where vendeur_id = v_vend and tenant_id = v_t
         and coalesce(devise, '—') = (select coalesce(devise, '—') from public.v_commandes_a_regler
                                       where vendeur_id = v_vend and tenant_id = v_t limit 1);

      v_etape := 'établir un relevé : une étape, total = l''encaissé';
      select * into r from public.etablir_releve(v_t, v_vend, v_ids, 'especes', null, null);
      -- ce qui est ENREGISTRÉ, pas seulement ce que la fonction renvoie
      if r.nb_commandes <> cardinality(v_ids)
         or (select total_ventes from public.reglements where id = r.reglement_id)
            is distinct from (select sum(p.montant) from public.paiements p where p.commande_id = any (v_ids))
         -- 09/11 : « à payer » = somme des nets − le transfert (le % copié) ; crédit et
         -- ajustements sont à 0 à l'établissement. La formule de calcul_net_releve, écrite ici :
         -- la répétition tourne en manager, et calcul_net_releve est fermée aux comptes.
         or (select net_a_payer from public.reglements where id = r.reglement_id)
            is distinct from (select x.s - case when x.s > 0 then round(x.s * g.frais_transfert_pct / 100, 2) else 0 end
                                from public.reglements g
                                cross join lateral (select sum(net) as s from public.reglements_commandes
                                                     where reglement_id = g.id) x
                               where g.id = r.reglement_id)
         or exists (select 1 from public.reglements_commandes
                     where reglement_id = r.reglement_id
                       and net is distinct from total_commande - frais_commande - frais_livraison - frais_upsell)
         or (select count(*) from public.reglements_commandes where reglement_id = r.reglement_id) <> cardinality(v_ids)
         or (select sum(montant) from public.reglements_commandes where reglement_id = r.reglement_id)
            is distinct from (select sum(p.montant) from public.paiements p where p.commande_id = any (v_ids)) then
        raise exception 'relevé établi incohérent (% commandes, total enregistré %)', r.nb_commandes,
          (select total_ventes from public.reglements where id = r.reglement_id);
      end if;

      v_etape := 'les mêmes commandes une 2e fois (double clic) : refusé, rien créé';
      select count(*) into n from public.reglements;
      v_refus := false;
      begin perform public.etablir_releve(v_t, v_vend, v_ids, 'especes', null, null);
      exception when others then v_refus := sqlerrm like '%déjà dans un relevé%';
      end;
      if not v_refus or (select count(*) from public.reglements) <> n then
        raise exception 'un second relevé sur les mêmes commandes est accepté ou laisse une trace';
      end if;

      v_etape := 'le total d''un relevé non payé ne se change pas à la main';
      v_refus := false;
      begin update public.reglements set total_ventes = 1 where id = r.reglement_id;
      exception when others then v_refus := sqlerrm like '%ne se modifient pas%';
      end;
      if not v_refus then raise exception 'le total d''un relevé se change à la main'; end if;

      v_etape := 'le manager ne marque pas payé (09/11)';
      v_refus := false;
      begin update public.reglements set statut = 'paye' where id = r.reglement_id;
      exception when others then v_refus := sqlerrm like '%Seul un admin%';
      end;
      if not v_refus then raise exception 'un manager marque un relevé payé'; end if;

      v_etape := '« Marquer payé » par un admin (ou le super admin), puis figé';
      if v_adm is null then raise exception 'aucun admin ni super admin pour payer'; end if;
      perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
      update public.reglements set statut = 'paye' where id = r.reglement_id;
      get diagnostics n = row_count;
      if n <> 1 then raise exception '« Marquer payé » ne passe plus'; end if;
      if (select paye_par from public.reglements where id = r.reglement_id) is distinct from v_adm then
        raise exception '« payé par » n''est pas l''admin qui a payé';
      end if;
      v_refus := false;
      begin update public.reglements set statut = 'en_attente' where id = r.reglement_id;
      exception when others then v_refus := sqlerrm like '%déjà payé%';
      end;
      if not v_refus then raise exception 'le relevé qu''on vient de payer se rouvre'; end if;
    end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'reglement_atomique.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'reglement_atomique.sql : relevé en une étape, total calculé par la base, payé = figé (répétition annulée).';
end $$;

commit;

-- Ce qui est en place
select (select string_agg(tablename || ' ' || cmd, ', ' order by tablename, cmd) from pg_policies
         where schemaname = 'public' and tablename in ('reglements', 'reglements_commandes')) as politiques,
       to_regprocedure('public.etablir_releve(uuid, uuid, uuid[], text, date, date)') as porte;
