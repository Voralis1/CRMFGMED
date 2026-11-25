-- =============================================================================
-- LIVRAISON ET PAIEMENT EN UNE SEULE ÉTAPE — 04/11/2026
-- NE MODIFIE AUCUNE DONNÉE. Ajoute une fonction. Rejouable.
-- À lancer AVANT de déployer confirmer-livraison (la nouvelle version l'appelle).
-- =============================================================================
--
-- LE TROU (lu le 04/11). confirmer-livraison faisait trois écritures séparées :
--   1. livraisons.statut = 'livre'  (→ le stock sort, trigger fn_ajuster_stock_livraison)
--   2. commandes.statut_livraison   (la copie sur la commande)
--   3. vérifie s'il y a déjà un paiement, puis le crée (en_attente).
-- Si la 3e échoue (réseau, délai, refus de la base), la livraison reste
-- « livrée », le stock est sorti, et AUCUN paiement n'existe : l'argent n'est
-- dans aucune caisse, le vendeur ne sera jamais payé (relevé = argent remis).
-- Et le livreur ne peut pas recommencer : une livraison close ne se rejoue pas.
-- (Lu le 04/11 : 0 livraison livrée sans paiement — pas encore arrivé.)
--
-- LA RÈGLE : enregistrer_livraison(livraison, statut, motif, montant) fait les
-- trois dans UNE transaction — tout ou rien. Si le paiement ne peut pas être
-- créé, la livraison reste comme avant et le stock ne bouge pas ; le livreur
-- voit l'erreur et appuie de nouveau.
--   · verrouille la livraison : deux appuis simultanés passent l'un après
--     l'autre ; le second voit « déjà close » ;
--   · statut : expedie / livre / retour / annule (a_preparer = le départ) ;
--   · montant ≥ 0, seulement pour « livre » ;
--   · paiement créé « en_attente » (inchangé : le manager encaisse, puis valide
--     la remise — sa décision 04/11) ;
--   · messages clairs (« déjà close », « un paiement existe déjà ») au lieu de
--     « duplicate key ».
-- Les contrôles d'identité (qui appelle, sa livraison, son entreprise) restent
-- dans confirmer-livraison. La fonction est réservée à la clé service (comme
-- enregistrer_appel) : aucun compte de l'application ne l'appelle directement.
--
--   §1 la fonction ;  §2 les droits ;  §3 répétition (annulée) : une vraie
--   livraison livrée → livraison + copie + paiement ensemble ; un paiement qui
--   échoue → RIEN n'a bougé (livraison, stock) ; un 2e appui → « déjà close ».
--
-- RETOUR ARRIÈRE : livraison_atomique_retour.sql (copie sur le Bureau) — puis
-- redéployer l'ancienne confirmer-livraison (git, voir ce fichier).
-- =============================================================================

begin;

-- §1 La fonction ------------------------------------------------------------------
create or replace function public.enregistrer_livraison(
  p_livraison uuid, p_statut text, p_motif text, p_montant numeric)
returns table (livraison_id uuid, paiement_id uuid, montant numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_liv      public.livraisons%rowtype;
  v_montant  numeric := 0;
  v_paiement uuid;
begin
  if p_statut is null or p_statut not in ('expedie', 'livre', 'retour', 'annule') then
    raise exception 'Statut de livraison invalide : %.', coalesce(p_statut, 'vide');
  end if;

  select * into v_liv from public.livraisons where id = p_livraison for update;
  if not found then
    raise exception 'Livraison introuvable.';
  end if;
  -- Une livraison close ne se rejoue pas : le montant irait une 2e fois dans la caisse.
  if v_liv.statut in ('livre', 'retour', 'annule') then
    raise exception 'Cette livraison est déjà close (%).', v_liv.statut;
  end if;

  if p_statut = 'livre' then
    v_montant := p_montant;
    if v_montant is null or v_montant < 0 then
      raise exception 'Montant encaissé invalide.';
    end if;
    if exists (select 1 from public.paiements where commande_id = v_liv.commande_id) then
      raise exception 'Un paiement existe déjà pour cette commande.';
    end if;
  end if;

  update public.livraisons
     set statut         = p_statut,
         motif_retour   = case when p_statut in ('retour', 'annule') then nullif(btrim(coalesce(p_motif, '')), '') end,
         date_livraison = case when p_statut = 'livre' then now() end
   where id = v_liv.id;

  update public.commandes
     set statut_livraison = p_statut, updated_at = now()
   where id = v_liv.commande_id and tenant_id = v_liv.tenant_id;

  if p_statut = 'livre' then
    insert into public.paiements (commande_id, livreur_id, tenant_id, montant, methode, statut)
    values (v_liv.commande_id, v_liv.livreur_id, v_liv.tenant_id, v_montant, 'cod', 'en_attente')
    returning id into v_paiement;
    update public.commandes set statut_paiement = 'en_attente'
     where id = v_liv.commande_id and tenant_id = v_liv.tenant_id;
  end if;

  return query select v_liv.id, v_paiement, case when p_statut = 'livre' then v_montant end;
end;
$$;
comment on function public.enregistrer_livraison(uuid, text, text, numeric) is 'fichier: livraison_atomique.sql';

-- §2 Les droits : la clé service seulement --------------------------------------------
revoke all on function public.enregistrer_livraison(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.enregistrer_livraison(uuid, text, text, numeric) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.enregistrer_livraison(uuid, text, text, numeric)', 'execute')
     or has_function_privilege('anon', 'public.enregistrer_livraison(uuid, text, text, numeric)', 'execute') then
    raise exception 'livraison_atomique.sql : un compte de l''application peut appeler enregistrer_livraison. Rien n''est installé.';
  end if;
  if not has_function_privilege('service_role', 'public.enregistrer_livraison(uuid, text, text, numeric)', 'execute') then
    raise exception 'livraison_atomique.sql : la clé service ne peut pas appeler enregistrer_livraison. Rien n''est installé.';
  end if;
end $$;

-- §3 Répétition (annulée) ----------------------------------------------------------------
do $$
declare
  v_liv     record;
  r         record;
  n         integer;
  v_msg     text;
  v_etape   text := 'préparation';
  v_refus   boolean;
begin
  -- une livraison ouverte, dans l'entreprise de test d'abord
  select l.id, l.commande_id, l.tenant_id into v_liv
    from public.livraisons l
   where l.statut = 'expedie'   -- 05/11 : « livrée » n'arrive qu'après « expédiée » (livraison_expediee_avant.sql)
     and not exists (select 1 from public.paiements p where p.commande_id = l.commande_id)
   order by (l.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc
   limit 1;
  if v_liv.id is null then
    raise notice 'livraison_atomique.sql : répétition sautée — aucune livraison « expédiée » sans paiement aujourd''hui. La fonction est installée (testée hors base).';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    execute 'set local role service_role';

    v_etape := 'un paiement qui échoue → rien ne bouge';
    -- un paiement déjà là : la fonction doit refuser AVANT de toucher la livraison
    insert into public.paiements (commande_id, livreur_id, tenant_id, montant, methode, statut)
    select v_liv.commande_id, l.livreur_id, l.tenant_id, 1, 'cod', 'en_attente' from public.livraisons l where l.id = v_liv.id;
    v_refus := false;
    begin
      perform public.enregistrer_livraison(v_liv.id, 'livre', null, 1000);
    exception when others then v_refus := sqlerrm like '%paiement existe déjà%';
    end;
    if not v_refus then raise exception 'un « Livré » passe alors qu''un paiement existe déjà'; end if;
    if (select statut from public.livraisons where id = v_liv.id) in ('livre') then
      raise exception 'la livraison est passée « livre » malgré le refus';
    end if;
    delete from public.paiements where commande_id = v_liv.commande_id;

    v_etape := '« Livré » : livraison + copie + paiement ensemble';
    select * into r from public.enregistrer_livraison(v_liv.id, 'livre', null, 1000);
    if (select statut from public.livraisons where id = v_liv.id) <> 'livre'
       or (select statut_livraison from public.commandes where id = v_liv.commande_id) <> 'livre'
       or (select count(*) from public.paiements where commande_id = v_liv.commande_id and statut = 'en_attente' and montant = 1000) <> 1
       or r.paiement_id is null then
      raise exception 'livraison, copie et paiement ne sont pas arrivés ensemble';
    end if;

    v_etape := 'un 2e appui → « déjà close »';
    v_refus := false;
    begin
      perform public.enregistrer_livraison(v_liv.id, 'livre', null, 1000);
    exception when others then v_refus := sqlerrm like '%déjà close%';
    end;
    select count(*) into n from public.paiements where commande_id = v_liv.commande_id;
    if not v_refus or n <> 1 then raise exception 'un 2e « Livré » passe ou crée un 2e paiement'; end if;

    execute 'reset role';
    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'livraison_atomique.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'livraison_atomique.sql : livraison + paiement en une étape (répétition annulée).';
end $$;

commit;

select to_regprocedure('public.enregistrer_livraison(uuid, text, text, numeric)') as fonction;
