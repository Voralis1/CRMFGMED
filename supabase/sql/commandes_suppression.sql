-- =============================================================================
-- SUPPRIMER UN LEAD / UNE COMMANDE — 12/11/2026 (sa décision)
-- NE MODIFIE AUCUNE COMMANDE EXISTANTE. Ajoute 2 permissions, un journal, 2 portes ;
-- ferme la suppression directe depuis le navigateur.
-- =============================================================================
--
-- SA DÉCISION (12/11) :
--   · un lead que PERSONNE n'a encore traité : le vendeur (ses leads), le manager,
--     l'admin peuvent le supprimer — il sort aussi du Centre d'appel ;
--   · une commande déjà traitée, ou dont le stock est déjà sorti : manager et admin
--     seulement, et LE STOCK REVIENT (mouvement « retour_ok », même produit, même
--     entrepôt, même quantité que la sortie) ;
--   · un lead supprimé puis renvoyé (boutique, API, CSV) revient comme un NOUVEAU
--     lead : le journal ne bloque rien.
--
-- AVANT CE FICHIER (lu en prod le 12/11) : pas de bouton, mais la politique
-- commandes_delete laissait admin, CEO et manager supprimer n'importe quelle
-- commande depuis la console — paiement et ligne de relevé vendeur partaient
-- avec (ON DELETE CASCADE), le stock sorti ne revenait jamais.
--
--   « NON TRAITÉ » (côté sûr, leçon 15) : statut Pending / Rupture de stock /
--   Produit non reconnu, AUCUNE tentative d'appel, aucun appel, aucune livraison,
--   stock pas sorti, et aucun autre statut dans son historique. Dès qu'un agent ou
--   un responsable l'a touché, le vendeur ne le supprime plus.
--   TOUJOURS REFUSÉ (même admin) : un paiement existe, la commande est sur un
--   relevé vendeur, ou elle est livrée — c'est de l'argent : statut « Retour ».
--
--   · permission supprimer_leads     : SES leads non traités (vendeur_id = soi). Par défaut : seller.
--   · permission supprimer_commandes : toute commande de l'entreprise (traitée ou non),
--                                       stock rendu. Par défaut : manager, admin. (Super admin : toutes.)
--   · plus d'une commande à la fois : en plus, actions_masse (sa règle du 30/10).
--   · journal commandes_supprimees : qui, quand, pourquoi, la commande entière
--     (donnees), le stock rendu. Lu par qui a supprimer_commandes. Jamais écrit à la main.
--   · suppression_commande_possible(id) : ce que l'écran demande avant d'afficher le bouton.
--   · supprimer_commandes(entreprise, ids, raison) : la seule porte (leçon 23) —
--     contrôle, rend le stock, libère les « Rupture », journal, supprime ; chaque
--     commande appliquée ou refusée seule, avec sa raison.
--
--   §1 prérequis ; §2 permissions ; §3 journal ; §4 l'état ; §5 les portes ;
--   §6 fermer la suppression directe ; §7 répétition (annulée) dans l'entreprise de test.
--
-- RETOUR ARRIÈRE : commandes_suppression_retour.sql (copie sur le Bureau) —
-- le journal est perdu, les commandes supprimées ne reviennent pas.
-- =============================================================================

begin;

-- §1 Prérequis ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.liberer_ruptures(uuid, uuid, uuid)') is null
     or to_regprocedure('public.a_la_permission(text)') is null then
    raise exception 'commandes_suppression.sql : lancez d''abord stock_regles.sql (liberer_ruptures). Rien n''est installé.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'commandes' and column_name = 'nb_tentatives')
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'commandes' and column_name = 'stock_ajuste') then
    raise exception 'commandes_suppression.sql : commandes.nb_tentatives ou stock_ajuste manque. Rien n''est installé.';
  end if;
end $$;

-- §2 Permissions (ajoutées une fois ; il les coche ensuite dans Rôles) ----------------
do $$
begin
  if not exists (select 1 from public.permissions where code = 'supprimer_leads') then
    insert into public.permissions (code, nom, module, description)
    values ('supprimer_leads', 'Supprimer ses leads non traités', 'Général',
            'Supprimer un de SES leads (vendeur) tant que personne ne l''a traité : en attente, aucun appel, stock pas sorti');
    insert into public.role_permissions (role_id, permission_code)
    select r.id, 'supprimer_leads' from public.roles r
     where r.nom in ('seller', 'super_admin') and r.tenant_id is null
    on conflict do nothing;
  end if;
  if not exists (select 1 from public.permissions where code = 'supprimer_commandes') then
    insert into public.permissions (code, nom, module, description)
    values ('supprimer_commandes', 'Supprimer une commande', 'Général',
            'Supprimer n''importe quelle commande de l''entreprise, même traitée ; le stock sorti revient. Jamais une commande payée, livrée ou sur un relevé');
    insert into public.role_permissions (role_id, permission_code)
    select r.id, 'supprimer_commandes' from public.roles r
     where r.nom in ('manager', 'admin', 'super_admin') and r.tenant_id is null
    on conflict do nothing;
  end if;
end $$;

-- §3 Le journal --------------------------------------------------------------------
create table if not exists public.commandes_supprimees (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  commande_id      uuid not null,               -- pas de clé étrangère : la commande n'existe plus
  lead_id          text,
  tracking_number  text,
  client_nom       text,
  client_telephone text,
  produit          text,
  quantite         integer,
  vendeur_id       uuid,
  statut           text,
  statut_livraison text,
  stock_rendu      integer not null default 0,
  raison           text not null,
  supprime_par     uuid,
  supprime_par_nom text,
  supprime_le      timestamptz not null default now(),
  donnees          jsonb not null
);
comment on table public.commandes_supprimees is 'fichier: commandes_suppression.sql — une ligne par commande supprimée (qui, quand, pourquoi, la commande entière). Écrite par supprimer_commandes seulement.';
create index if not exists commandes_supprimees_tenant on public.commandes_supprimees (tenant_id, supprime_le desc);

alter table public.commandes_supprimees enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'commandes_supprimees'
  loop execute format('drop policy %I on public.commandes_supprimees', p.policyname); end loop;
end $$;
create policy commandes_supprimees_lecture on public.commandes_supprimees for select to authenticated
  using (public.is_super_admin()
         or (tenant_id = public.get_my_tenant_id() and public.a_la_permission('supprimer_commandes')));
revoke all on public.commandes_supprimees from public, anon, authenticated;
grant select on public.commandes_supprimees to authenticated;
grant all on public.commandes_supprimees to service_role;

-- §4 L'état d'une commande (sans les droits de qui demande) ------------------------
--   niveau : 'lead' (non traité) · 'commande' (traitée / stock sorti) · 'refuse'
--   avertissement : le colis est chez un livreur.
create or replace function public.etat_suppression_commande(p_id uuid)
returns table (niveau text, motif text, avertissement text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.commandes%rowtype; v_liv text; v_livreur text;
begin
  select * into c from public.commandes where id = p_id;
  if not found then
    return query select 'refuse'::text, 'Commande introuvable (déjà supprimée ?).'::text, null::text; return;
  end if;
  if exists (select 1 from public.paiements p where p.commande_id = p_id) then
    return query select 'refuse'::text,
      'Un paiement existe pour cette commande (argent encaissé) : elle ne se supprime pas. Utilisez le statut « Retour ».'::text, null::text; return;
  end if;
  if exists (select 1 from public.reglements_commandes r where r.commande_id = p_id) then
    return query select 'refuse'::text,
      'Cette commande est sur un relevé vendeur : elle ne se supprime pas.'::text, null::text; return;
  end if;
  select l.statut, lv.nom into v_liv, v_livreur
    from public.livraisons l left join public.livreurs lv on lv.id = l.livreur_id
   where l.commande_id = p_id order by l.created_at desc nulls last limit 1;
  if v_liv = 'livre' then
    return query select 'refuse'::text,
      'Commande livrée : elle ne se supprime pas. Utilisez le statut « Retour ».'::text, null::text; return;
  end if;

  if c.statut_confirmation in ('Pending', 'Rupture de stock', 'Produit non reconnu')
     and coalesce(c.nb_tentatives, 0) = 0
     and c.stock_ajuste is null
     and not exists (select 1 from public.appels a where a.commande_id = p_id)
     and not exists (select 1 from public.livraisons l where l.commande_id = p_id)
     and not exists (select 1 from public.historique_statuts h
                      where h.commande_id = p_id
                        and h.statut not in ('Pending', 'Rupture de stock', 'Produit non reconnu')) then
    return query select 'lead'::text, null::text, null::text; return;
  end if;

  return query select 'commande'::text, null::text,
    case when c.stock_ajuste is not null and v_liv = 'expedie' then
      'Le colis est chez le livreur ' || coalesce(v_livreur, '?') || ' : récupérez-le. Le stock revient à l''entrepôt dès la suppression.'
    end;
end;
$$;
revoke all on function public.etat_suppression_commande(uuid) from public, anon, authenticated;
comment on function public.etat_suppression_commande(uuid) is 'fichier: commandes_suppression.sql';

-- Les droits de QUI DEMANDE sur cette commande (motif si refusé).
create or replace function public.droit_suppression_commande(p_id uuid)
returns table (permis boolean, motif text, avertissement text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.commandes%rowtype; e record;
begin
  select * into c from public.commandes where id = p_id;
  if not found or auth.uid() is null
     or not (public.is_super_admin() or c.tenant_id = public.get_my_tenant_id()) then
    return query select false, 'Commande introuvable (déjà supprimée ?).'::text, null::text; return;
  end if;
  select * into e from public.etat_suppression_commande(p_id);
  if e.niveau = 'refuse' then
    return query select false, e.motif, null::text; return;
  end if;
  if public.is_super_admin() or public.a_la_permission('supprimer_commandes') then
    return query select true, null::text, e.avertissement; return;
  end if;
  if e.niveau = 'lead' and public.a_la_permission('supprimer_leads') and c.vendeur_id = auth.uid() then
    return query select true, null::text, null::text; return;
  end if;
  if e.niveau = 'commande' and public.a_la_permission('supprimer_leads') and c.vendeur_id = auth.uid() then
    return query select false, 'Ce lead est déjà traité (appel, statut ou stock) : seul un manager ou un admin peut le supprimer.'::text, null::text; return;
  end if;
  return query select false, 'Votre rôle ne permet pas de supprimer cette commande.'::text, null::text;
end;
$$;
revoke all on function public.droit_suppression_commande(uuid) from public, anon, authenticated;
comment on function public.droit_suppression_commande(uuid) is 'fichier: commandes_suppression.sql';

-- §5 Les portes ----------------------------------------------------------------------
-- Ce que l'écran demande avant d'afficher « Supprimer ».
create or replace function public.suppression_commande_possible(p_id uuid)
returns table (permis boolean, motif text, avertissement text)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.droit_suppression_commande(p_id)
$$;
revoke all on function public.suppression_commande_possible(uuid) from public, anon;
grant execute on function public.suppression_commande_possible(uuid) to authenticated, service_role;
comment on function public.suppression_commande_possible(uuid) is 'fichier: commandes_suppression.sql';

create or replace function public.supprimer_commandes(p_tenant uuid, p_ids uuid[], p_raison text)
returns table (commande_id uuid, resultat text, motif text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_raison text := btrim(coalesce(p_raison, ''));
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null);
  v_id uuid; c public.commandes%rowtype; d record; m record;
  v_rendu integer; v_liv text; v_nom text;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour supprimer une commande.' using errcode = '42501';
  end if;
  if not (public.is_super_admin() or p_tenant is not distinct from public.get_my_tenant_id()) then
    raise exception 'Cette entreprise n''est pas la vôtre.' using errcode = '42501';
  end if;
  if v_raison = '' then
    raise exception 'La raison de la suppression est obligatoire.';
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return;
  end if;
  if array_length(v_ids, 1) > 500 then
    raise exception 'Au plus 500 commandes à la fois.';
  end if;
  if array_length(v_ids, 1) > 1 and not (public.is_super_admin() or public.a_la_permission('actions_masse')) then
    raise exception 'Supprimer plusieurs commandes à la fois demande la permission « actions_masse ».' using errcode = '42501';
  end if;
  select coalesce(u.email, auth.uid()::text) into v_nom from public.user_roles u where u.user_id = auth.uid() limit 1;

  foreach v_id in array v_ids loop
    begin
      -- verrou : un agent qui enregistre au même moment passe avant, puis on relit
      select * into c from public.commandes where id = v_id for update;
      if not found or c.tenant_id is distinct from p_tenant then
        return query select v_id, 'refuse'::text, 'Commande introuvable (déjà supprimée ?).'::text; continue;
      end if;
      select * into d from public.droit_suppression_commande(v_id);
      if not d.permis then
        return query select v_id, 'refuse'::text, d.motif; continue;
      end if;

      -- le stock sorti revient : l'inverse exact de la sortie de cette commande
      v_rendu := 0;
      if c.stock_ajuste is not null then
        select mv.produit_id, mv.entrepot_id, mv.quantite into m
          from public.mouvements_stock mv
         where mv.tenant_id = c.tenant_id and mv.type_mouvement = 'sortie'
           and mv.notes = 'Livraison commande ' || c.id
         order by mv.created_at desc limit 1;
        if found then
          insert into public.mouvements_stock (tenant_id, produit_id, entrepot_id, type_mouvement, quantite, notes)
          values (c.tenant_id, m.produit_id, m.entrepot_id, 'retour_ok', m.quantite,
                  'Suppression commande ' || coalesce(c.lead_id, '?') || ' (' || c.id || ') : ' || v_raison);
          v_rendu := m.quantite;
        end if;
      end if;

      select l.statut into v_liv from public.livraisons l where l.commande_id = v_id order by l.created_at desc nulls last limit 1;
      insert into public.commandes_supprimees
        (tenant_id, commande_id, lead_id, tracking_number, client_nom, client_telephone, produit, quantite,
         vendeur_id, statut, statut_livraison, stock_rendu, raison, supprime_par, supprime_par_nom, donnees)
      values
        (c.tenant_id, c.id, c.lead_id, c.tracking_number, c.client_nom, c.client_telephone, c.produit, c.quantite,
         c.vendeur_id, c.statut_confirmation, v_liv, v_rendu, v_raison, auth.uid(), v_nom, to_jsonb(c));

      -- appels et livraison partent avec (CASCADE) ; l'historique reste, sans lien
      delete from public.commandes where id = v_id;

      -- les unités promises (ou rendues) vont aux « Rupture de stock » qui attendent
      if c.produit_id is not null and c.entrepot_id is not null then
        perform public.liberer_ruptures(c.tenant_id, c.produit_id, c.entrepot_id);
      end if;
      return query select v_id, 'applique'::text, null::text;
    exception when others then
      -- cette commande seule est annulée (stock, journal, suppression) ; les autres continuent
      return query select v_id, 'refuse'::text, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function public.supprimer_commandes(uuid, uuid[], text) from public, anon;
grant execute on function public.supprimer_commandes(uuid, uuid[], text) to authenticated, service_role;
comment on function public.supprimer_commandes(uuid, uuid[], text) is 'fichier: commandes_suppression.sql';

-- §6 Fermer la suppression directe (le navigateur passe par la porte) ----------------
-- Lu le 12/11 : aucune page ni Edge Function ne fait delete sur commandes ; la
-- suppression d'une entreprise (super admin) passe par la cascade, pas par ce droit.
drop policy if exists commandes_delete on public.commandes;
revoke delete on public.commandes from anon, authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.commandes', 'delete')
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commandes' and cmd in ('DELETE', 'ALL')) then
    raise exception 'commandes_suppression.sql : le navigateur peut encore supprimer une commande en direct. Rien n''est installé.';
  end if;
  if has_table_privilege('authenticated', 'public.commandes_supprimees', 'insert')
     or has_table_privilege('authenticated', 'public.commandes_supprimees', 'delete') then
    raise exception 'commandes_suppression.sql : le journal s''écrit en direct. Rien n''est installé.';
  end if;
end $$;

-- §7 Répétition (annulée) dans l'entreprise de test ----------------------------------
--   un vendeur supprime son lead neuf ; il est refusé sur un lead déjà tenté ; le
--   manager le supprime ; la suppression directe est refusée. Tout est annulé.
do $$
declare
  c_test constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  v_seller uuid; v_mgr uuid; v_pays uuid; v_a uuid; v_b uuid;
  r record; v_msg text; v_etape text := 'préparation'; v_refus boolean;
begin
  if not exists (select 1 from public.tenants where id = c_test) then
    raise notice 'commandes_suppression.sql : pas d''entreprise de test — répétition sautée.';
    return;
  end if;
  select u.user_id into v_seller from public.user_roles u join public.roles ro on ro.id = u.role_id
   where u.tenant_id = c_test and ro.nom = 'seller' and ro.tenant_id is null limit 1;
  select u.user_id into v_mgr from public.user_roles u join public.roles ro on ro.id = u.role_id
   where u.tenant_id = c_test and ro.nom = 'manager' and ro.tenant_id is null limit 1;
  select id into v_pays from public.pays where tenant_id = c_test order by nom limit 1;
  if v_seller is null or v_mgr is null or v_pays is null then
    raise notice 'commandes_suppression.sql : l''entreprise de test n''a pas de vendeur, de manager ou de pays — répétition sautée.';
    return;
  end if;

  begin
    v_etape := 'deux leads neufs du vendeur';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, prix, pays_id, vendeur_id, ville_zone, adresse)
    values (c_test, 'REPETITION-SUPPR-A', 'Répétition A', '+244900000001', 'répétition suppression', 0, v_pays, v_seller, 'Luanda', 'rue')
    returning id into v_a;
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, prix, pays_id, vendeur_id, ville_zone, adresse)
    values (c_test, 'REPETITION-SUPPR-B', 'Répétition B', '+244900000002', 'répétition suppression', 0, v_pays, v_seller, 'Luanda', 'rue')
    returning id into v_b;
    -- B : déjà tenté (le compteur se calcule d'habitude depuis l'historique ; ici posé, puis annulé)
    perform set_config('crm.suivi_recalcul', 'oui', true);
    update public.commandes set nb_tentatives = 1 where id = v_b;
    perform set_config('crm.suivi_recalcul', '', true);

    v_etape := 'le vendeur supprime son lead neuf';
    perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select * into r from public.supprimer_commandes(c_test, array[v_a], 'répétition');
    if r.resultat is distinct from 'applique' then raise exception 'lead neuf : %', coalesce(r.motif, r.resultat, 'rien'); end if;

    v_etape := 'le vendeur est refusé sur un lead déjà tenté';
    select * into r from public.supprimer_commandes(c_test, array[v_b], 'répétition');
    if r.resultat is distinct from 'refuse' or r.motif not like '%déjà traité%' then
      raise exception 'lead tenté : % / %', r.resultat, r.motif;
    end if;

    v_etape := 'suppression directe refusée';
    v_refus := false;
    begin delete from public.commandes where id = v_b;
    exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'le navigateur supprime encore en direct'; end if;

    v_etape := 'le manager supprime le lead tenté';
    perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
    select * into r from public.supprimer_commandes(c_test, array[v_b], 'répétition');
    if r.resultat is distinct from 'applique' then raise exception 'manager : %', coalesce(r.motif, r.resultat, 'rien'); end if;

    execute 'reset role';
    v_etape := 'vérification';
    if exists (select 1 from public.commandes where id in (v_a, v_b)) then raise exception 'une commande reste'; end if;
    if (select count(*) from public.commandes_supprimees where commande_id in (v_a, v_b)) <> 2 then
      raise exception 'le journal n''a pas ses 2 lignes';
    end if;
    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    if v_msg <> 'REPETITION_OK' then
      raise exception 'commandes_suppression.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'commandes_suppression.sql : suppression par la porte seulement ; vendeur = ses leads non traités, manager / admin = toute commande non payée (stock rendu). Répétition annulée.';
end $$;

commit;

-- Ce qui est en place
select (select string_agg(r.nom, ', ' order by r.nom) from public.role_permissions rp join public.roles r on r.id = rp.role_id
         where rp.permission_code = 'supprimer_leads')     as supprimer_leads,
       (select string_agg(r.nom, ', ' order by r.nom) from public.role_permissions rp join public.roles r on r.id = rp.role_id
         where rp.permission_code = 'supprimer_commandes') as supprimer_commandes,
       has_table_privilege('authenticated', 'public.commandes', 'delete') as navigateur_supprime_en_direct;
