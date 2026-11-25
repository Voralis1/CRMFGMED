-- Corps de PRODUCTION de receptionner_expedition, lu le 29/10/2026 (pg_get_functiondef).
-- md5(prosrc) = f7dc5d30c0152cb5d9b4d93554e900d4. Les lignes sont écrites AVANT entrepot_reception_id.
CREATE OR REPLACE FUNCTION public.receptionner_expedition(p_expedition uuid, p_date timestamp with time zone, p_entrepot uuid, p_lignes jsonb)
 RETURNS TABLE(lignes integer, total_declare integer, total_recu integer, ecart integer, entrepot_retenu uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_exp      public.expeditions;
  v_entrepot uuid;
  v_pays     uuid;
  v_nb       int;
  l          record;
begin
  select * into v_exp from public.expeditions where id = p_expedition;
  if v_exp.id is null then
    raise exception 'Expédition introuvable';
  end if;

  if not (public.is_super_admin()
          or (v_exp.tenant_id = public.get_my_tenant_id() and public.gere_la_config())) then
    raise exception 'Seuls le manager et l''administrateur confirment une expédition';
  end if;

  -- Déjà comptée. On regarde `entrepot_reception_id`, pas la date ni le
  -- statut : c'est la seule colonne qu'aucun formulaire ne remplit, donc la
  -- seule qui prouve que le stock est monté.
  if v_exp.entrepot_reception_id is not null then
    raise exception 'Cette expédition a déjà été confirmée le %',
      to_char(coalesce(v_exp.date_reception, now()), 'DD/MM/YYYY à HH24:MI');
  end if;

  -- On ne confirme que ce qui attend. Refusée, elle ne revient pas.
  if v_exp.statut = 'refusee' then
    raise exception 'Une expédition refusée ne peut pas être confirmée';
  end if;

  -- Le dépôt : celui passé en argument, sinon la destination, sinon le seul
  -- entrepôt du pays visé. Depuis le 13/10 il n'y en a qu'un par pays, donc
  -- la question ne se pose plus — le code la garde au cas où.
  v_entrepot := coalesce(p_entrepot, v_exp.entrepot_destination_id);

  if v_entrepot is null then
    v_pays := v_exp.pays_destination_id;
    if v_pays is null and v_exp.pays_code is not null then
      select id into v_pays from public.pays
       where tenant_id = v_exp.tenant_id
         and upper(btrim(code)) = upper(btrim(v_exp.pays_code))
       limit 1;
    end if;

    select count(*) into v_nb from public.entrepots
     where tenant_id = v_exp.tenant_id and pays_id = v_pays;

    if v_nb = 0 then
      raise exception 'Aucun entrepôt dans le pays de destination : créez-le d''abord';
    elsif v_nb > 1 then
      raise exception 'Plusieurs entrepôts dans ce pays : lancez entrepots_un_par_pays.sql';
    end if;

    select id into v_entrepot from public.entrepots
     where tenant_id = v_exp.tenant_id and pays_id = v_pays;
  end if;

  if not exists (
    select 1 from public.entrepots
     where id = v_entrepot and tenant_id = v_exp.tenant_id
  ) then
    raise exception 'Cet entrepôt n''appartient pas à l''entreprise de l''expédition';
  end if;

  -- Les quantités déclarées, telles quelles. `p_lignes` n'est plus lu : il
  -- reste dans la signature pour ne pas casser l'appel existant, et pour le
  -- jour où une expédition voyagera vraiment.
  for l in
    select ep.id, ep.produit_id, coalesce(ep.quantite, 0) as quantite
    from public.expeditions_produits ep
    where ep.expedition_id = p_expedition
  loop
    update public.expeditions_produits
       set quantite_recue = l.quantite
     where id = l.id;

    if l.quantite > 0 and l.produit_id is not null then
      insert into public.mouvements_stock
        (tenant_id, produit_id, entrepot_id, type_mouvement, quantite, notes)
      values
        (v_exp.tenant_id, l.produit_id, v_entrepot, 'entree', l.quantite,
         'Expédition ' || coalesce(v_exp.reference, '?') || ' confirmée');
    end if;
  end loop;

  -- `quantite_totale` : le cumul « passé chez nous depuis le début ». Le
  -- trigger ne le tient pas, il ne s'occupe que du stock disponible.
  update public.produits p
     set quantite_totale = coalesce(p.quantite_totale, 0) + s.recu
    from (
      select ep.produit_id, sum(coalesce(ep.quantite_recue, 0))::int as recu
        from public.expeditions_produits ep
       where ep.expedition_id = p_expedition and ep.produit_id is not null
       group by ep.produit_id
    ) s
   where p.id = s.produit_id and s.recu > 0;

  update public.expeditions
     set statut                = 'confirmee',
         date_reception        = coalesce(p_date, now()),
         entrepot_reception_id = v_entrepot,
         recu_par              = auth.uid(),
         confirme_par          = coalesce(confirme_par, auth.uid()),
         confirme_le           = coalesce(confirme_le, now())
   where id = p_expedition;

  return query
    select count(*)::int,
           coalesce(sum(ep.quantite), 0)::int,
           coalesce(sum(ep.quantite_recue), 0)::int,
           0,
           v_entrepot
      from public.expeditions_produits ep
     where ep.expedition_id = p_expedition;
end;
$function$
;
