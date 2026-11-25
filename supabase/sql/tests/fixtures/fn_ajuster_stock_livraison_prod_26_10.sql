-- fn_ajuster_stock_livraison tel qu'en prod le 26/10 (pg_get_functiondef), avant stock_livraison_autre_vendeur.sql.
CREATE OR REPLACE FUNCTION public.fn_ajuster_stock_livraison()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cmd        public.commandes%rowtype;
  v_type       text;
  v_quantite   integer;
  v_produit    uuid;
  v_entrepot   uuid;
  v_note       text;
  v_sans_ligne boolean := false;
  p            record;
begin
  -- --- Que vient-il de se passer ? ---------------------------------------
  -- INSERT et UPDATE sont traités séparément : sur INSERT, `OLD` n'existe
  -- pas, et le lire lève une erreur qui ferait échouer toute la livraison.
  if tg_op = 'INSERT' then
    if new.statut = 'livre' then
      v_type := 'sortie';
    else
      return new;
    end if;
  else
    if old.statut is not distinct from new.statut then
      return new;
    end if;
    if new.statut = 'livre' then
      v_type := 'sortie';
    elsif old.statut = 'livre' then
      -- Livrée puis dé-livrée : la marchandise revient au dépôt.
      v_type := 'retour_ok';
    else
      return new;
    end if;
  end if;
  select * into v_cmd from public.commandes c where c.id = new.commande_id;
  if not found then
    return new;
  end if;
  -- --- A-t-on déjà compté ? ----------------------------------------------
  -- La preuve est `stock_ajuste`, pas le statut : le statut peut être remis
  -- à `livre` autant de fois qu'un manager le souhaite.
  if v_type = 'sortie' and v_cmd.stock_ajuste is not null then
    return new;
  end if;
  if v_type = 'retour_ok' and v_cmd.stock_ajuste is null then
    -- Rien n'est jamais sorti : il n'y a rien à rendre.
    return new;
  end if;
  -- --- Combien ? ----------------------------------------------------------
  -- Une commande sans quantité est une commande d'une unité : c'est le cas
  -- courant en COD, et refuser de compter serait pire que compter 1.
  v_quantite := coalesce(v_cmd.quantite, 1);
  if v_quantite <= 0 then
    v_note := 'Quantité ' || v_quantite || ' : rien à décompter.';
  end if;
  -- --- Quel dépôt, quel produit ? -----------------------------------------
  if v_note is null then
    v_entrepot := coalesce(v_cmd.entrepot_id,
                           public.entrepot_du_pays(v_cmd.tenant_id, v_cmd.pays_id));
    if v_entrepot is null then
      v_note := 'Aucun entrepôt dans le pays de la commande : rien à décompter.';
    else
      select * into p from public.produit_de_commande(v_cmd.tenant_id, v_cmd.produit);
      v_produit := p.produit_id;
      if v_produit is null then
        -- On ne sait pas quoi sortir.
        v_note := p.raison;
      elsif v_type = 'sortie' then
        v_sans_ligne := not exists (select 1 from public.stocks s
                                     where s.produit_id = v_produit and s.entrepot_id = v_entrepot);
      end if;
    end if;
  end if;
  -- --- Ce qui n'a pas pu être fait se dit ---------------------------------
  -- La livraison n'est JAMAIS bloquée : le livreur est devant le client, le
  -- problème est au bureau. Mais il est écrit noir sur blanc.
  if v_note is not null then
    update public.commandes set stock_note = v_note where id = v_cmd.id;
    return new;
  end if;
  -- --- Le mouvement, et rien d'autre --------------------------------------
  -- Sans ligne de stock, trg_actualiser_stock la crée à 0 : le stock passe
  -- en négatif. C'est vrai, et la note le dit.
  insert into public.mouvements_stock
    (tenant_id, produit_id, entrepot_id, type_mouvement, quantite, notes)
  values
    (v_cmd.tenant_id, v_produit, v_entrepot, v_type, v_quantite,
     case v_type when 'sortie' then 'Livraison commande ' else 'Retour livraison commande ' end
       || v_cmd.id);
  update public.commandes
     set stock_ajuste = case when v_type = 'sortie' then now() else null end,
         stock_note   = case when v_sans_ligne then
                          'Livré sans stock déclaré dans l''entrepôt '
                          || coalesce((select e.nom from public.entrepots e where e.id = v_entrepot), '?')
                          || ' : son stock y est passé en négatif. Déclarez l''entrée de la marchandise.'
                        end,
         entrepot_id  = v_entrepot
   where id = v_cmd.id;
  return new;
end;
$function$
;
