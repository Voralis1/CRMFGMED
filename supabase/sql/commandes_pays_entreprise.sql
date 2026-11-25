-- =====================================================================
-- LE PAYS D'UNE COMMANDE APPARTIENT À SON ENTREPRISE — 23/10/2026
-- Un seul fichier. Ne modifie AUCUNE commande existante. Rejouable.
-- =====================================================================
--
-- Pourquoi : le pays d'une commande décide de son entrepôt. Un pays d'une
-- autre entreprise, c'est une marchandise qui part du mauvais entrepôt et
-- un stock qui sort du mauvais endroit. Jusqu'ici, rien ne le vérifiait :
--   · confirmer-appel écrit le pays_id qu'on lui envoie (clé service) ;
--   · la policy commandes_insert ne regarde pas le pays ;
--   · trg_zz_entrepot_commande ne refuse qu'un ENTREPÔT écrit : un pays
--     étranger laissait simplement l'entrepôt vide.
--
-- Ce que fait le fichier :
--   §1  vérifie qu'aucune commande existante n'a déjà un pays d'une autre
--       entreprise. S'il y en a une, le fichier s'arrête là, rien n'est
--       installé, et les commandes sont nommées (id + lead_id, rien d'autre).
--   §2  la fonction + le trigger trg_zy_pays_commande.
--   §3  la preuve, sur la vraie base : une tentative réelle d'écrire un pays
--       étranger sur une commande, annulée quoi qu'il arrive.
--
-- PAS d'exemption `if auth.uid() is null then return new` ici, exprès.
-- Ce garde-fou habituel laisse passer la clé service et l'éditeur SQL. Or
-- confirmer-appel tourne avec la clé service : c'est justement le chemin
-- qui écrivait sans vérifier. L'exempter, ce serait protéger contre tout
-- le monde sauf le seul appelant qui posait problème. Ce trigger s'applique
-- donc à tous : navigateur, Edge Functions, éditeur SQL.
--
-- Chemins légitimes vérifiés (23/10), aucun n'écrit un pays étranger :
--   · import-commande : le pays est résolu parmi les pays de l'entreprise de
--     la source, ou son pays_defaut (lui-même gardé par tr_sources_pays_defaut) ;
--   · formulaire manuel, import CSV, Centre d'appel : listes chargées avec
--     tenant_id = l'entreprise affichée, et tenant_id écrit avec la même ;
--   · aucune fonction SQL de la base n'insère de commande ni n'en change le
--     pays (lu dans pg_proc le 23/10).
-- =====================================================================


-- §1 — Rien d'existant ne doit déjà violer la règle ---------------------
-- Relu au moment du passage, pas d'après une lecture de la veille.
do $$
declare
  v_n     int;
  v_liste text;
begin
  select count(*),
         string_agg(c.id::text || ' (lead ' || coalesce(c.lead_id, '?') || ')', ', ')
           filter (where c.rn <= 10)
    into v_n, v_liste
    from (select c.*, row_number() over (order by c.created_at) rn
            from public.commandes c
            join public.pays p on p.id = c.pays_id
           where p.tenant_id <> c.tenant_id) c;

  if v_n > 0 then
    raise exception 'Arrêt : % commande(s) ont déjà un pays d''une autre entreprise. Rien n''est installé. À corriger d''abord : %', v_n, v_liste;
  end if;
  raise notice '§1 : 0 commande avec un pays d''une autre entreprise.';
end $$;


-- §2 — La règle -------------------------------------------------------------
-- SECURITY DEFINER : la question « ce pays est-il à cette entreprise ? »
-- doit avoir la même réponse quel que soit l'appelant, sans dépendre de ce
-- que la RLS de `pays` lui laisse lire.
--
-- Le message ne nomme pas le pays refusé : c'est celui d'une autre
-- entreprise, l'appelant n'a pas à apprendre son nom.
create or replace function public.commande_pays_de_l_entreprise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- pays_id est NOT NULL : la contrainte de la table s'en charge.
  if new.pays_id is null then
    return new;
  end if;

  -- Ni le pays ni l'entreprise n'ont changé : déjà vérifié à l'écriture
  -- précédente (et §1 a vérifié l'existant).
  if tg_op = 'UPDATE'
     and new.pays_id   is not distinct from old.pays_id
     and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;

  if not exists (select 1 from public.pays p
                  where p.id = new.pays_id
                    and p.tenant_id = new.tenant_id) then
    raise exception using
      errcode = 'check_violation',
      message = 'Pays refusé : ce pays n''appartient pas à l''entreprise de la commande.',
      hint    = 'Choisissez un pays de cette entreprise (Paramètres → Pays).';
  end if;

  return new;
end;
$$;

revoke all on function public.commande_pays_de_l_entreprise() from public, anon, authenticated;

-- Le nom fixe l'ordre (les triggers BEFORE passent par ordre alphabétique) :
--   · APRÈS trg_set_tenant_id_commandes, qui remplit tenant_id à l'insert ;
--   · AVANT trg_zz_entrepot_commande, pour que le refus parle du pays et
--     non de l'entrepôt qui en découle.
-- « update of tenant_id » aussi : déplacer une commande vers une autre
-- entreprise sans changer son pays est la même faute.
drop trigger if exists trg_zy_pays_commande on public.commandes;
create trigger trg_zy_pays_commande
  before insert or update of pays_id, tenant_id on public.commandes
  for each row execute function public.commande_pays_de_l_entreprise();


-- §3 — La preuve, sur la vraie base -----------------------------------------
-- On prend une vraie commande et le pays d'une AUTRE entreprise, et on tente
-- l'écriture, ici, depuis l'éditeur SQL : le compte le plus puissant, celui
-- qu'un garde-fou habituel aurait laissé passer. Le bloc intérieur finit
-- toujours par une exception, ce qui annule la tentative dans tous les cas :
-- aucune commande ne peut rester modifiée.
-- Sans second pays dans la base, on tente un identifiant de pays inventé
-- (le trigger passe avant la clé étrangère, il doit répondre le premier).
do $$
declare
  v_cmd     uuid;
  v_pays    uuid;
  v_cas     text;
  v_erreur  text;
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_zy_pays_commande'
                    and tgrelid = 'public.commandes'::regclass
                    and tgenabled <> 'D') then
    raise exception '§3 : le trigger trg_zy_pays_commande est absent ou désactivé.';
  end if;

  -- Une commande que trg_valider_commande (qui passe avant) laisse passer,
  -- pour que ce soit bien NOTRE trigger qui réponde.
  select c.id, p.id into v_cmd, v_pays
    from public.commandes c
    join public.pays p on p.tenant_id <> c.tenant_id
   where btrim(coalesce(c.client_nom, '')) <> ''
     and btrim(coalesce(c.client_telephone, '')) <> ''
     and btrim(coalesce(c.produit, '')) <> ''
     and c.prix >= 0
   limit 1;
  v_cas := 'pays d''une autre entreprise';

  if v_cmd is null then
    select c.id, gen_random_uuid() into v_cmd, v_pays
      from public.commandes c
     where btrim(coalesce(c.client_nom, '')) <> ''
       and btrim(coalesce(c.client_telephone, '')) <> ''
       and btrim(coalesce(c.produit, '')) <> ''
       and c.prix >= 0
     limit 1;
    v_cas := 'pays inexistant';
  end if;

  if v_cmd is null then
    raise notice '§3 : aucune commande dans la base, tentative impossible. Le trigger est en place.';
    return;
  end if;

  begin
    update public.commandes set pays_id = v_pays where id = v_cmd;
    raise exception 'TENTATIVE_PASSEE';
  exception when others then
    v_erreur := sqlerrm;
  end;

  if v_erreur = 'TENTATIVE_PASSEE' then
    raise exception '§3 : ÉCHEC — un % a été accepté sur une commande. (Tentative annulée.)', v_cas;
  elsif v_erreur not like 'Pays refusé%' then
    raise exception '§3 : refus inattendu, ce n''est pas le trigger qui a répondu : %', v_erreur;
  end if;

  raise notice '§3 : % refusé depuis l''éditeur SQL (« % »). Aucune commande modifiée.', v_cas, v_erreur;
end $$;
