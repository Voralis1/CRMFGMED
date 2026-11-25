-- =============================================================================
-- LE VENDEUR D'UNE COMMANDE EST UN VRAI VENDEUR — 04/11/2026 (T7)
-- NE MODIFIE AUCUNE COMMANDE. Ajoute une règle (trigger). Rejouable.
-- =============================================================================
--
-- LE TROU (lu le 03–04/11). Le formulaire « Nouvelle commande » mettait comme
-- vendeur LA PERSONNE QUI CRÉE la commande : créée par un manager ou le super
-- admin, la commande avait un manager pour « vendeur » et n'entrait dans aucun
-- relevé (2 commandes de test, effacées par le nettoyage du 04/11). Rien dans
-- la base ne l'interdisait.
--
-- LA RÈGLE : commandes.vendeur_id est VIDE, ou un compte VENDEUR (seller) de la
-- MÊME entreprise. Tous les chemins : écran, import CSV, API (import-commande,
-- clé service), éditeur SQL — pas d'exemption, c'est exactement ce qu'on veut
-- arrêter. Vérifiée à la création, et quand le vendeur ou l'entreprise d'une
-- commande change (une commande dont le vendeur a changé de rôle depuis n'est
-- pas bloquée pour autant : seule une écriture du vendeur est contrôlée).
-- Vide reste permis (anciennes commandes, sources sans vendeur) ; l'écran
-- impose le choix d'un vendeur au manager / admin (sa décision 04/11).
--
--   §1 s'arrête et NOMME les commandes qui violent déjà la règle (lu le 04/11 : 0) ;
--   §2 la fonction + le trigger « trg_zx_vendeur_commande » (après
--      trg_set_tenant_id_commandes : l'ordre des noms) ;
--   §3 répétition (annulée) : un manager comme vendeur refusé, un vendeur
--      d'une autre entreprise refusé, un vrai vendeur accepté, vide accepté.
--
-- RETOUR ARRIÈRE : vendeur_commande_retour.sql (copie sur le Bureau).
-- =============================================================================

begin;

-- §1 Ce qui viole déjà la règle --------------------------------------------------
do $$
declare n integer; v_liste text;
begin
  select count(*), string_agg(c.lead_id || ' (' || coalesce(u.role, 'compte inconnu') || ')', ', ')
    into n, v_liste
    from public.commandes c
    left join public.user_roles u on u.user_id = c.vendeur_id
   where c.vendeur_id is not null
     and not exists (select 1 from public.user_roles s
                      where s.user_id = c.vendeur_id and s.tenant_id = c.tenant_id and lower(s.role) = 'seller');
  if n > 0 then
    raise exception 'vendeur_commande.sql : % commande(s) ont un « vendeur » qui n''est pas un vendeur de leur entreprise : %. Corrigez-les d''abord. Rien n''est installé.', n, left(v_liste, 1500);
  end if;
end $$;

-- §2 La règle ------------------------------------------------------------------------
create or replace function public.commande_vendeur_valide()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  if new.vendeur_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.vendeur_id is not distinct from old.vendeur_id
     and new.tenant_id is not distinct from old.tenant_id then
    return new;   -- le vendeur n'est pas réécrit : rien à contrôler
  end if;
  select lower(u.role) into v_role from public.user_roles u
   where u.user_id = new.vendeur_id and u.tenant_id = new.tenant_id;
  if v_role is distinct from 'seller' then
    raise exception 'Le vendeur d''une commande doit être un compte vendeur de l''entreprise (ce compte est : %). Choisissez un vendeur.',
      coalesce(v_role, 'hors de cette entreprise');
  end if;
  return new;
end;
$$;
revoke all on function public.commande_vendeur_valide() from public, anon, authenticated;
comment on function public.commande_vendeur_valide() is 'fichier: vendeur_commande.sql';

drop trigger if exists trg_zx_vendeur_commande on public.commandes;
create trigger trg_zx_vendeur_commande
  before insert or update of vendeur_id, tenant_id on public.commandes
  for each row execute function public.commande_vendeur_valide();

-- §3 Répétition (annulée) ---------------------------------------------------------------
do $$
declare
  v_t uuid; v_pays uuid; v_mgr uuid; v_seller uuid; v_autre uuid;
  v_msg text; v_etape text := 'préparation'; v_refus boolean;
begin
  select u.tenant_id, u.user_id into v_t, v_mgr from public.user_roles u
   where lower(u.role) in ('manager', 'admin', 'super_admin')
   order by (u.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc limit 1;
  select user_id into v_seller from public.user_roles where tenant_id = v_t and lower(role) = 'seller' limit 1;
  select user_id into v_autre from public.user_roles where tenant_id <> v_t and lower(role) = 'seller' limit 1;
  select id into v_pays from public.pays where tenant_id = v_t order by nom limit 1;
  if v_t is null or v_pays is null then
    raise notice 'vendeur_commande.sql : répétition sautée (pas d''entreprise avec un pays et un responsable).';
    return;
  end if;

  begin
    v_etape := 'un manager comme vendeur → refusé';
    v_refus := false;
    begin
      insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, vendeur_id)
      values (v_t, 'REPETITION-VENDEUR-' || gen_random_uuid(), 'R', '+000', 'R', 1, 0, v_pays, 'R', v_mgr);
    exception when others then v_refus := sqlerrm like '%doit être un compte vendeur%';
    end;
    if not v_refus then raise exception 'un manager est accepté comme vendeur'; end if;

    if v_autre is not null then
      v_etape := 'un vendeur d''une autre entreprise → refusé';
      v_refus := false;
      begin
        insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, vendeur_id)
        values (v_t, 'REPETITION-VENDEUR-' || gen_random_uuid(), 'R', '+000', 'R', 1, 0, v_pays, 'R', v_autre);
      exception when others then v_refus := sqlerrm like '%hors de cette entreprise%';
      end;
      if not v_refus then raise exception 'un vendeur d''une autre entreprise est accepté'; end if;
    end if;

    if v_seller is not null then
      v_etape := 'un vrai vendeur → accepté';
      insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, vendeur_id)
      values (v_t, 'REPETITION-VENDEUR-' || gen_random_uuid(), 'R', '+000', 'R', 1, 0, v_pays, 'R', v_seller);
    end if;

    v_etape := 'sans vendeur → accepté';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, vendeur_id)
    values (v_t, 'REPETITION-VENDEUR-' || gen_random_uuid(), 'R', '+000', 'R', 1, 0, v_pays, 'R', null);

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'vendeur_commande.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'vendeur_commande.sql : le vendeur d''une commande est un vrai vendeur de l''entreprise, ou vide (répétition annulée).';
end $$;

commit;

select tgname from pg_trigger where tgname = 'trg_zx_vendeur_commande';
