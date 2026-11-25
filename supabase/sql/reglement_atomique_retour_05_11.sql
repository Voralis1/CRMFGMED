-- =============================================================================
-- RETOUR ARRIÈRE des frais par lead (05/11) dans reglement_atomique.sql
-- =============================================================================
-- Remet etablir_releve et reglements_garde EXACTEMENT comme lus en prod le
-- 05/11 au matin (md5 9b118381… / 6006aff7…, vérifiés) : relevé sans frais
-- (net = encaissé). Les relevés déjà établis gardent leurs lignes et leurs
-- montants. À lancer AVANT frais_vendeurs_retour.sql. Rejouable.
-- =============================================================================
begin;

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

  insert into public.reglements (tenant_id, vendeur_id, periode_debut, periode_fin, methode, devise,
                                 nb_commandes, total_ventes, net_a_payer, cree_par)
  values (p_tenant, p_vendeur, v_debut, v_fin, coalesce(p_methode, 'especes'),
          nullif(v_devises[1], '—'), v_nb, v_total, v_total, auth.uid())
  returning id, reglements.reference into v_id, v_ref;

  insert into public.reglements_commandes (commande_id, reglement_id, tenant_id, montant)
  select c.id, v_id, p_tenant, p.montant
    from public.commandes c join public.paiements p on p.commande_id = c.id
   where c.id = any (v_ids);

  return query select v_id, v_ref, v_nb, v_total;
end;
$$;
comment on function public.etablir_releve(uuid, uuid, uuid[], text, date, date) is 'fichier: reglement_atomique.sql';

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

  if tg_op = 'UPDATE' then
    -- Payé = figé : rien ne change, le statut non plus (sinon on le rouvre,
    -- on le vide, on le supprime, et ses commandes repassent « à régler »).
    if old.statut = 'paye' and row(new.*) is distinct from row(old.*) then
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
       or new.periode_debut is distinct from old.periode_debut
       or new.periode_fin   is distinct from old.periode_fin
       or new.devise        is distinct from old.devise
       or new.cree_par      is distinct from old.cree_par
       or new.created_at    is distinct from old.created_at then
      raise exception 'Le vendeur, les montants, la période et la devise d''un relevé se calculent à son établissement : ils ne se modifient pas.';
    end if;
    if new.statut = 'paye' and old.statut <> 'paye' and new.date_paiement is null then
      new.date_paiement := now();
    end if;
  end if;

  return new;
end;
$$;
comment on function public.reglements_garde() is 'fichier: reglement_atomique.sql';

do $$
begin
  if (select md5(prosrc) from pg_proc where proname = 'etablir_releve') <> '9b118381df810f06ada2f7daed136fcb'
     or (select md5(prosrc) from pg_proc where proname = 'reglements_garde') <> '6006aff7c899a4754ebd97c5818a4fa9' then
    raise exception 'Retour arrière : les corps remis ne sont pas ceux du 05/11 au matin (md5). Rien n''est changé.';
  end if;
  raise notice 'etablir_releve et reglements_garde : corps du 05/11 au matin remis (md5 vérifiés).';
end $$;

commit;
