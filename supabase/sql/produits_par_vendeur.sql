-- =============================================================================
-- LES PRODUITS PAR VENDEUR — 10/11/2026 (T14, sa règle)
-- NE MODIFIE AUCUNE COMMANDE NI AUCUN PRODUIT. Change une règle d'unicité et
-- la façon dont une commande trouve son produit.
-- =============================================================================
--
-- SA RÈGLE : « le même nom chez deux vendeurs = deux produits ». LU EN PROD LE
-- 10/11 :
--   · idx_produits_code_unique = (entreprise, code) : deux vendeurs d'une même
--     entreprise ne pouvaient pas avoir chacun leur « clearzal » ;
--   · commande_produit_id (le trigger qui relie une commande à son produit, à
--     l'arrivée et quand son texte change) cherchait dans TOUTE l'entreprise :
--     la commande du vendeur A pouvait être reliée au produit du vendeur B —
--     mauvais stock, mauvaise rupture.
--
-- CE QUE FAIT LE FICHIER :
--   §1 l'unicité du code devient (entreprise, vendeur, code). Même nom
--      d'index (l'écran Produits lit ce nom dans l'erreur). Les doublons sont
--      cherchés AVANT (aucun lu le 10/11) ; rien n'est touché s'il y en a.
--   §2 produit_de_commande_vendeur(entreprise, texte, vendeur) : la règle de
--      produit_de_commande (code, puis nom, texte_normalise), d'abord dans les
--      produits DU VENDEUR, puis dans les produits SANS vendeur (sa réponse du
--      10/11 : un produit sans vendeur reste utilisable par tous, comme avant,
--      après ceux du vendeur). Jamais chez un autre vendeur. Sans vendeur sur la
--      commande : la règle d'avant (toute l'entreprise).
--   §3 commande_produit_id (repris de commandes_produit_id.sql, marqué) : la
--      même porte, avec le vendeur de la commande ; et CHANGER LE VENDEUR d'une
--      commande la relie de nouveau (sauf une commande reliée par son SKU de
--      boutique : la correspondance est déjà propre à la source et à son
--      vendeur — correspondances_sku.sql). Le trigger écoute aussi vendeur_id.
--      Toujours refusé : écrire produit_id à la main.
--   §3 bis remplir_produits_commandes (l'outil « relier les liens vides ») : repris,
--      même règle par vendeur.
--   §4 répétition annulée sur de vraies lignes, puis vérification.
--
-- Les commandes déjà reliées ne bougent pas (le lien ne se recalcule qu'à un
-- changement de texte ou de vendeur).
-- Pas repris (texte de secours seulement, le lien produit_id passe avant) :
-- resoudre_entrepot_commande, fn_ajuster_stock_livraison.
--
-- RETOUR ARRIÈRE : produits_par_vendeur_retour.sql (copie sur le Bureau).
-- Il refuse tant que deux vendeurs partagent un code (l'index d'avant ne
-- pourrait pas revenir).
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.produit_de_commande(uuid, text)') is null
     or to_regprocedure('public.texte_normalise(text)') is null
     or not exists (select 1 from pg_trigger where tgname = 'trg_zz_produit_commande') then
    raise exception 'produits_par_vendeur.sql : commandes_produit_id.sql (et texte_normalise) d''abord. Rien n''est installé.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'produits' and column_name = 'vendeur_id') then
    raise exception 'produits_par_vendeur.sql : produits.vendeur_id absent. Rien n''est installé.';
  end if;
end $$;

-- §1 Le code : unique par vendeur ------------------------------------------------------
do $$
declare d text;
begin
  select string_agg(format('%s / %s → "%s" ×%s', tenant_id, coalesce(vendeur_id::text, 'sans vendeur'), c, n), '; ')
    into d
    from (select tenant_id, vendeur_id, lower(btrim(code)) c, count(*) n
            from public.produits
           where code is not null and btrim(code) <> ''
           group by 1, 2, 3 having count(*) > 1) x;
  if d is not null then
    raise exception 'produits_par_vendeur.sql : codes en double chez un même vendeur, à corriger d''abord : %. Rien n''est installé.', d;
  end if;
end $$;

drop index if exists public.idx_produits_code_unique;
create unique index idx_produits_code_unique
  on public.produits (tenant_id, coalesce(vendeur_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(code)))
  where code is not null and btrim(code) <> '';

-- §2 La règle : le produit d'une commande, chez son vendeur -------------------------------
create or replace function public.produit_de_commande_vendeur(p_tenant uuid, p_produit text, p_vendeur uuid)
returns table (produit_id uuid, cas text, raison text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_texte   text := btrim(coalesce(p_produit, ''));
  v_nom     text;
  v_produit uuid;
  v_combien integer;
  v_partage boolean;
begin
  if p_vendeur is null then
    return query select * from public.produit_de_commande(p_tenant, p_produit);
    return;
  end if;
  if v_texte = '' then
    return query select null::uuid, 'sans_produit'::text, 'La commande ne porte aucun nom de produit.'::text;
    return;
  end if;
  v_nom := public.texte_normalise(v_texte);

  -- d'abord les produits du vendeur, puis ceux sans vendeur ; chaque fois le
  -- code, puis le nom ; deux réponses au même niveau = ambigu (on ne choisit pas).
  foreach v_partage in array array[false, true] loop
    select count(*), min(p.id::text)::uuid into v_combien, v_produit
      from public.produits p
     where p.tenant_id = p_tenant
       and (case when v_partage then p.vendeur_id is null else p.vendeur_id = p_vendeur end)
       and p.code is not null and btrim(p.code) <> ''
       and public.texte_normalise(p.code) = v_nom;
    if v_combien = 1 then
      return query select v_produit, 'trouve'::text, null::text;
      return;
    elsif v_combien > 1 then
      return query select null::uuid, 'produit_ambigu'::text,
        (v_combien || ' produits portent le code « ' || v_texte || ' » (aux accents près) : impossible de savoir lequel décompter.')::text;
      return;
    end if;

    select count(*), min(p.id::text)::uuid into v_combien, v_produit
      from public.produits p
     where p.tenant_id = p_tenant
       and (case when v_partage then p.vendeur_id is null else p.vendeur_id = p_vendeur end)
       and public.texte_normalise(p.product) = v_nom;
    if v_combien = 1 then
      return query select v_produit, 'trouve'::text, null::text;
      return;
    elsif v_combien > 1 then
      return query select null::uuid, 'produit_ambigu'::text,
        (v_combien || ' produits portent le nom « ' || v_texte || ' » : impossible de savoir lequel décompter.')::text;
      return;
    end if;
  end loop;

  return query select null::uuid, 'produit_inconnu'::text,
    ('Produit « ' || v_texte || ' » introuvable au catalogue de ce vendeur.')::text;
end;
$$;
revoke all on function public.produit_de_commande_vendeur(uuid, text, uuid) from public, anon, authenticated;
comment on function public.produit_de_commande_vendeur(uuid, text, uuid) is 'fichier: produits_par_vendeur.sql';

-- §3 Le trigger : la commande et son produit, chez son vendeur -------------------------------
create or replace function public.commande_produit_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.produit is distinct from old.produit
     or new.tenant_id is distinct from old.tenant_id then
    select r.produit_id into new.produit_id
      from public.produit_de_commande_vendeur(new.tenant_id, new.produit, new.vendeur_id) r;
    return new;
  end if;

  -- 10/11 : autre vendeur → le produit se cherche chez lui. Une commande reliée
  -- par son SKU de boutique (multiplicateur_sku posé) garde son lien.
  if new.vendeur_id is distinct from old.vendeur_id and new.multiplicateur_sku is null then
    select r.produit_id into new.produit_id
      from public.produit_de_commande_vendeur(new.tenant_id, new.produit, new.vendeur_id) r;
    return new;
  end if;

  if new.produit_id is not distinct from old.produit_id then
    return new;
  end if;
  if coalesce(current_setting('crm.produit_rattrapage', true), '') = 'oui' then
    return new;
  end if;
  if new.produit_id is null
     and not exists (select 1 from public.produits where id = old.produit_id) then
    return new; -- le produit vient d'être supprimé : la commande passe en « non reconnu »
  end if;
  raise exception 'Le produit d''une commande se déduit de son texte (« % ») : produit_id ne s''écrit pas à la main.', new.produit;
end;
$$;
revoke all on function public.commande_produit_id() from public, anon, authenticated;
comment on function public.commande_produit_id() is 'fichier: produits_par_vendeur.sql';

create or replace trigger trg_zz_produit_commande
  before insert or update of produit, produit_id, tenant_id, vendeur_id on public.commandes
  for each row execute function public.commande_produit_id();

-- §3 bis L'outil « relier les commandes sans lien » (repris de commandes_produit_id.sql) :
-- la même règle, chez le vendeur de chaque commande. Ne touche que les liens VIDES.
create or replace function public.remplir_produits_commandes()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n integer;
begin
  perform set_config('crm.produit_rattrapage', 'oui', true);
  update public.commandes c
     set produit_id = r.produit_id
    from (select c2.id, x.produit_id
            from public.commandes c2
            cross join lateral public.produit_de_commande_vendeur(c2.tenant_id, c2.produit, c2.vendeur_id) x
           where c2.produit_id is null) r
   where c.id = r.id and r.produit_id is not null;
  get diagnostics v_n = row_count;
  perform set_config('crm.produit_rattrapage', '', true);
  return v_n;
end;
$$;
revoke all on function public.remplir_produits_commandes() from public, anon, authenticated;
comment on function public.remplir_produits_commandes() is 'fichier: produits_par_vendeur.sql';

-- §4 Répétition (annulée) et vérification ---------------------------------------------------
do $$
declare
  v_t uuid; v_v1 uuid; v_v2 uuid; v_p1 uuid; v_p2 uuid; v_ps uuid;
  r record; v_msg text; v_etape text := 'préparation'; v_refus boolean;
begin
  -- deux vendeurs d'une même entreprise (l'entreprise de test d'abord)
  select u1.tenant_id, u1.user_id, u2.user_id into v_t, v_v1, v_v2
    from public.user_roles u1 join public.user_roles u2
      on u2.tenant_id = u1.tenant_id and u2.user_id <> u1.user_id and lower(u2.role) = 'seller'
   where lower(u1.role) = 'seller'
   order by (u1.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, u1.user_id, u2.user_id
   limit 1;
  if v_t is null then
    raise notice 'produits_par_vendeur.sql : répétition sautée — aucune entreprise avec deux vendeurs. La règle est installée (testée hors base).';
  else
    begin
      v_etape := 'deux vendeurs, le même code';
      insert into public.produits (tenant_id, vendeur_id, product, code) values (v_t, v_v1, 'Répétition T14', 'repetition-t14') returning id into v_p1;
      insert into public.produits (tenant_id, vendeur_id, product, code) values (v_t, v_v2, 'Répétition T14', 'repetition-t14') returning id into v_p2;

      v_etape := 'un même vendeur, deux fois le même code → refusé';
      v_refus := false;
      begin
        insert into public.produits (tenant_id, vendeur_id, product, code) values (v_t, v_v1, 'Répétition T14 bis', 'REPETITION-T14');
      exception when unique_violation then v_refus := true;
      end;
      if not v_refus then raise exception 'deux produits au même code chez un même vendeur'; end if;

      v_etape := 'le produit de la commande, chez son vendeur';
      select * into r from public.produit_de_commande_vendeur(v_t, 'repetition-t14', v_v2);
      if r.produit_id is distinct from v_p2 then raise exception 'le code du vendeur 2 donne un autre produit'; end if;
      select * into r from public.produit_de_commande_vendeur(v_t, 'Répétition T14', v_v1);
      if r.produit_id is distinct from v_p1 then raise exception 'le nom chez le vendeur 1 donne un autre produit'; end if;

      v_etape := 'un produit sans vendeur : pour tous, après ceux du vendeur';
      insert into public.produits (tenant_id, vendeur_id, product, code) values (v_t, null, 'Répétition T14 commun', 'repetition-t14-commun') returning id into v_ps;
      select * into r from public.produit_de_commande_vendeur(v_t, 'repetition-t14-commun', v_v2);
      if r.produit_id is distinct from v_ps then raise exception 'le produit sans vendeur n''est pas trouvé'; end if;

      v_etape := 'jamais chez un autre vendeur';
      delete from public.produits where id = v_p2;
      select * into r from public.produit_de_commande_vendeur(v_t, 'repetition-t14', v_v2);
      if r.produit_id is not null then raise exception 'la commande du vendeur 2 prend le produit du vendeur 1'; end if;

      raise exception 'REPETITION_OK';
    exception when others then
      v_msg := sqlerrm;
      if v_msg <> 'REPETITION_OK' then
        raise exception 'produits_par_vendeur.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
      end if;
    end;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_produits_code_unique'
                  and indexdef ilike '%vendeur_id%') then
    raise exception 'produits_par_vendeur.sql : l''index n''est pas par vendeur. Rien n''est installé.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgname = 'trg_zz_produit_commande' and t.tgenabled = 'O'
                  and pg_get_triggerdef(t.oid) ilike '%vendeur_id%') then
    raise exception 'produits_par_vendeur.sql : le trigger n''écoute pas vendeur_id. Rien n''est installé.';
  end if;
  raise notice 'produits_par_vendeur.sql : code unique par vendeur ; une commande trouve son produit chez son vendeur (puis les produits sans vendeur). Aucune donnée modifiée.';
end $$;

commit;
