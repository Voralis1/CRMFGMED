-- =============================================================================
-- Corriger la quantité d'une expédition APPROUVÉE — 30/10/2026
-- =============================================================================
--
-- LE TROU : changer la quantité d'une ligne après la réception changeait
-- l'expédition et laissait le stock tel quel. Lu le 30/10 : EXP-000031,
-- « test1 » — déclaré 140, reçu 150, mouvement d'entrée 150, entrepôt 150.
--
-- LA RÈGLE (sa décision du 30/10) : la nouvelle quantité RÉÉCRIT le mouvement
-- d'entrée d'origine, comme si elle avait été saisie dès le départ. Pas de
-- mouvement de correction, pas de « +50 puis −10 » : une faute de frappe ne
-- mérite pas une ligne au registre. Prix accepté : on ne distingue plus
-- « on a reçu 40 » de « quelqu'un a saisi 50 puis corrigé ».
--
-- LE SEUL GARDE-FOU : refusé si le stock de l'entrepôt deviendrait négatif
-- (50 entrés, 45 déjà sortis : passer à 40 laisserait −5). Le message dit
-- combien sont déjà sortis depuis cette réception.
--
-- LE STOCK EST RECALCULÉ ICI, pas par le trigger : trg_actualiser_stock ne
-- tourne qu'à l'INSERTION d'un mouvement. Réécrire un mouvement ne change
-- rien tout seul ; cette fonction ajoute la différence à
-- stocks.quantite_disponible (l'entrepôt de réception), à
-- produits.current_quantity et à produits.quantite_totale (que
-- receptionner_expedition tient lui-même), et pose quantite_recue = la
-- nouvelle quantité. Une seule écriture de chaque, dans la même transaction.
--
-- CE QUI NE CHANGE PAS : tout le reste de la modification d'une expédition
-- (avant réception : rien de neuf ; ajouter/retirer une ligne après : comme
-- avant). Seule la QUANTITÉ d'une ligne d'une expédition reçue est concernée.
--
-- Le mouvement d'origine se retrouve par ce que receptionner_expedition écrit :
-- type « entree », même produit, entrepôt de réception, note « Expédition
-- <référence> confirmée ». Zéro ou plusieurs → refusé, rien ne change.
--
-- §1 prérequis ; §2 la fonction ; §3 le trigger ; §4 vérification ;
-- §5 répétition (de vraies écritures, annulées). Ne modifie AUCUNE ligne
-- existante : le rattrapage d'EXP-000031 est le fichier 2.
-- Retour arrière : expeditions_quantite_recue_retour.sql.
-- Exécutable en entier, et deux fois.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.receptionner_expedition(uuid, timestamptz, uuid, jsonb)') is null then
    raise exception 'receptionner_expedition absent. Rien n''a été installé.';
  end if;
  -- Le mouvement d'origine se retrouve par la note que la réception écrit :
  -- si elle a changé, ce fichier ne saurait plus le retrouver.
  if not exists (select 1 from pg_proc where proname = 'receptionner_expedition'
                  and prosrc like '%''Expédition '' || coalesce(v_exp.reference, ''?'') || '' confirmée''%') then
    raise exception 'receptionner_expedition n''écrit plus la note « Expédition <référence> confirmée » : ce fichier ne retrouverait pas les mouvements. Rien n''a été installé.';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_actualiser_stock'
              and (tgtype & 16) <> 0) then
    raise exception 'trg_actualiser_stock tourne aussi à la MODIFICATION d''un mouvement : la correction compterait deux fois. Rien n''a été installé.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. La correction d'une ligne (interne : le trigger et le rattrapage)
-- -----------------------------------------------------------------------------
create or replace function public.corriger_quantite_recue(p_ligne uuid, p_quantite integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_l      public.expeditions_produits;
  v_e      public.expeditions;
  v_m      public.mouvements_stock;
  v_s      public.stocks;
  v_n      integer;
  v_delta  integer;
  v_sortis integer;
  v_ent    text;
  v_nom    text;
begin
  select * into v_l from public.expeditions_produits where id = p_ligne;
  select * into v_e from public.expeditions where id = v_l.expedition_id;
  if v_e.entrepot_reception_id is null then
    return; -- pas reçue : aucun mouvement, rien à corriger
  end if;
  if p_quantite is null or p_quantite < 0 then
    raise exception 'Quantité invalide : %.', p_quantite;
  end if;
  if v_l.produit_id is null or coalesce(v_l.recu_sans_mouvement, false) then
    return; -- produit supprimé : plus de ligne de stock, rien à recalculer
  end if;

  select count(*) into v_n from public.mouvements_stock m
   where m.tenant_id = v_e.tenant_id and m.type_mouvement = 'entree'
     and m.produit_id = v_l.produit_id and m.entrepot_id = v_e.entrepot_reception_id
     and m.notes = 'Expédition ' || coalesce(v_e.reference, '?') || ' confirmée';
  if v_n <> 1 then
    raise exception 'Mouvement d''entrée de cette réception introuvable (% trouvé(s)) : quantité non corrigée.', v_n;
  end if;
  select * into v_m from public.mouvements_stock m
   where m.tenant_id = v_e.tenant_id and m.type_mouvement = 'entree'
     and m.produit_id = v_l.produit_id and m.entrepot_id = v_e.entrepot_reception_id
     and m.notes = 'Expédition ' || coalesce(v_e.reference, '?') || ' confirmée'
   for update;

  v_delta := p_quantite - v_m.quantite;
  if v_delta = 0 then
    return;
  end if;

  select * into v_s from public.stocks s
   where s.produit_id = v_l.produit_id and s.entrepot_id = v_e.entrepot_reception_id
   for update;
  if not found then
    raise exception 'Ligne de stock introuvable pour ce produit dans l''entrepôt de réception : quantité non corrigée.';
  end if;

  if v_s.quantite_disponible + v_delta < 0 then
    select nom into v_ent from public.entrepots where id = v_e.entrepot_reception_id;
    select coalesce(product, v_l.produit_nom) into v_nom from public.produits where id = v_l.produit_id;
    select coalesce(sum(case m.type_mouvement when 'sortie' then m.quantite when 'retour_ok' then -m.quantite else 0 end), 0)
      into v_sortis
      from public.mouvements_stock m
     where m.produit_id = v_l.produit_id and m.entrepot_id = v_e.entrepot_reception_id
       and m.created_at >= v_m.created_at and m.id <> v_m.id;
    raise exception 'Refusé : % « % » sont déjà sortis de l''entrepôt % depuis cette réception (il en reste %). Passer de % à % mettrait le stock à %.',
      v_sortis, v_nom, v_ent, v_s.quantite_disponible, v_m.quantite, p_quantite, v_s.quantite_disponible + v_delta;
  end if;

  update public.mouvements_stock set quantite = p_quantite where id = v_m.id;
  update public.stocks set quantite_disponible = quantite_disponible + v_delta where id = v_s.id;
  update public.produits
     set current_quantity = coalesce(current_quantity, 0) + v_delta,
         quantite_totale  = coalesce(quantite_totale, 0) + v_delta
   where id = v_l.produit_id;
end;
$$;
revoke all on function public.corriger_quantite_recue(uuid, integer) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. Le trigger : la quantité d'une ligne d'expédition REÇUE change
-- -----------------------------------------------------------------------------
create or replace function public.expedition_quantite_recue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quantite is not distinct from old.quantite
     or not exists (select 1 from public.expeditions
                     where id = new.expedition_id and entrepot_reception_id is not null) then
    return new;
  end if;
  perform public.corriger_quantite_recue(old.id, new.quantite);
  new.quantite_recue := new.quantite; -- comme si elle avait été saisie dès le départ
  return new;
end;
$$;
revoke all on function public.expedition_quantite_recue() from public, anon, authenticated;

create or replace trigger trg_zz_expedition_quantite_recue
  before update of quantite on public.expeditions_produits
  for each row execute function public.expedition_quantite_recue();


-- -----------------------------------------------------------------------------
-- 4. Vérification
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_zz_expedition_quantite_recue' and tgenabled <> 'D') then
    raise exception 'trg_zz_expedition_quantite_recue absent ou désactivé.';
  end if;
  raise notice 'expeditions_quantite_recue.sql : en place. Aucune ligne existante modifiée (rattrapage : fichier 2).';
end $$;


-- -----------------------------------------------------------------------------
-- 5. Répétition : de VRAIES écritures, puis tout est annulé
-- -----------------------------------------------------------------------------
-- Un produit et une expédition créés ; 50 déclarés ; la VRAIE réception
-- (receptionner_expedition, compte d'un manager) ; 45 sortent ; puis :
--   1. passer à 40 → refusé, le message dit « 45 … déjà sortis » ; rien n'a bougé ;
--   2. passer à 60 → mouvement 60, entrepôt 15, produit +10, total +10, reçu 60 ;
--   3. passer à 55 → entrepôt 10 ; et à chaque étape : entrepôt = entrées −
--      sorties de ce produit dans cet entrepôt (aucune double écriture).
do $$
declare
  v_ent  public.entrepots;
  v_resp uuid;
  v_p    uuid;
  v_x    uuid;
  v_l    uuid;
  v_code text := 'repet' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_msg  text;
  v_stock int; v_mvt int; v_cour int; v_tot int; v_recu int; v_somme int;
begin
  select e.* into v_ent from public.entrepots e
   where e.pays_id is not null
     and exists (select 1 from public.user_roles ur where ur.tenant_id = e.tenant_id and ur.role in ('admin', 'manager'))
   order by (e.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, e.tenant_id limit 1;
  select ur.user_id into v_resp from public.user_roles ur
   where ur.tenant_id = v_ent.tenant_id and ur.role in ('admin', 'manager') order by ur.user_id limit 1;
  if v_ent.id is null or v_resp is null then
    raise exception 'Répétition impossible : aucune entreprise avec un entrepôt et un manager/admin.';
  end if;

  begin
    insert into public.produits (tenant_id, product, code, current_quantity) values (v_ent.tenant_id, 'Répétition', v_code, 0) returning id into v_p;
    insert into public.expeditions (tenant_id, pays, entrepot_destination_id, statut)
    values (v_ent.tenant_id, 'Répétition', v_ent.id, 'en_attente') returning id into v_x;
    insert into public.expeditions_produits (tenant_id, expedition_id, produit_id, quantite)
    values (v_ent.tenant_id, v_x, v_p, 50) returning id into v_l;

    perform set_config('request.jwt.claims', json_build_object('sub', v_resp, 'role', 'authenticated')::text, true);
    perform * from public.receptionner_expedition(v_x, now(), v_ent.id, '[]'::jsonb);
    perform set_config('request.jwt.claims', '', true);
    insert into public.mouvements_stock (tenant_id, produit_id, entrepot_id, type_mouvement, quantite, notes)
    values (v_ent.tenant_id, v_p, v_ent.id, 'sortie', 45, 'répétition');
    if (select quantite_disponible from public.stocks where produit_id = v_p and entrepot_id = v_ent.id) <> 5 then
      raise exception 'préparation : le stock devrait être 5 après 50 entrés et 45 sortis';
    end if;

    -- 1. vers 40 : refusé
    v_msg := null;
    begin update public.expeditions_produits set quantite = 40 where id = v_l;
    exception when others then v_msg := sqlerrm; end;
    if v_msg is null or v_msg not like 'Refusé : 45 % sont déjà sortis%mettrait le stock à -5.' then
      raise exception '50 → 40 avec 45 sortis : attendu un refus nommant 45 et −5, obtenu « % »', coalesce(v_msg, 'accepté');
    end if;
    if (select quantite from public.expeditions_produits where id = v_l) <> 50
       or (select quantite_disponible from public.stocks where produit_id = v_p and entrepot_id = v_ent.id) <> 5 then
      raise exception 'refus : quelque chose a bougé quand même';
    end if;

    -- 2. vers 60
    update public.expeditions_produits set quantite = 60 where id = v_l;
    select quantite_disponible into v_stock from public.stocks where produit_id = v_p and entrepot_id = v_ent.id;
    select quantite into v_mvt from public.mouvements_stock where produit_id = v_p and type_mouvement = 'entree';
    select current_quantity, quantite_totale into v_cour, v_tot from public.produits where id = v_p;
    select quantite_recue into v_recu from public.expeditions_produits where id = v_l;
    if (v_stock, v_mvt, v_cour, v_tot, v_recu) is distinct from (15, 60, 15, 60, 60) then
      raise exception '50 → 60 : attendu entrepôt 15, mouvement 60, produit 15, total 60, reçu 60 ; obtenu %, %, %, %, %', v_stock, v_mvt, v_cour, v_tot, v_recu;
    end if;
    if (select count(*) from public.mouvements_stock where produit_id = v_p) <> 2 then
      raise exception 'un mouvement de correction a été écrit (la règle : réécrire, pas ajouter)';
    end if;

    -- 3. vers 55, et l'invariant entrepôt = entrées − sorties
    update public.expeditions_produits set quantite = 55 where id = v_l;
    select coalesce(sum(case type_mouvement when 'entree' then quantite when 'sortie' then -quantite else 0 end), 0)
      into v_somme from public.mouvements_stock where produit_id = v_p and entrepot_id = v_ent.id;
    if (select quantite_disponible from public.stocks where produit_id = v_p and entrepot_id = v_ent.id) <> 10 or v_somme <> 10 then
      raise exception '60 → 55 : entrepôt et mouvements ne disent pas 10';
    end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'expeditions_quantite_recue.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', v_msg;
    end if;
  end;
  if exists (select 1 from public.produits where code = v_code) then
    raise exception 'Répétition : des écritures sont restées.';
  end if;
  raise notice 'expeditions_quantite_recue.sql : répétition réussie (refus −5 avec 45 sortis, 60 puis 55 recalculés, aucun mouvement ajouté), tout annulé.';
end $$;

-- Les lignes reçues dont la quantité ne correspond plus à leur mouvement
-- (ce que le fichier 2 alignera) :
select e.reference, coalesce(ep.produit_nom, '?') as produit, ep.quantite as declaree, m.quantite as mouvement
  from public.expeditions e
  join public.expeditions_produits ep on ep.expedition_id = e.id
  join public.mouvements_stock m on m.type_mouvement = 'entree' and m.produit_id = ep.produit_id
       and m.entrepot_id = e.entrepot_reception_id and m.notes = 'Expédition ' || coalesce(e.reference, '?') || ' confirmée'
 where e.entrepot_reception_id is not null and ep.quantite <> m.quantite;
