-- produit_de_commande de PRODUCTION, lu le 29/10/2026 (expression recopiée), md5(prosrc) 4112f39b12057d67b1daaf1a36df44e2.
CREATE OR REPLACE FUNCTION public.produit_de_commande(p_tenant uuid, p_produit text)
 RETURNS TABLE(produit_id uuid, cas text, raison text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_texte   text := btrim(coalesce(p_produit, ''));
  v_nom     text;
  v_produit uuid;
  v_combien integer;
begin
  if v_texte = '' then
    return query select null::uuid, 'sans_produit'::text,
      'La commande ne porte aucun nom de produit.'::text;
    return;
  end if;

  v_nom := lower(regexp_replace(btrim(public.unaccent_simple(v_texte)), '\s+', ' ', 'g'));

  select count(*), min(p.id::text)::uuid into v_combien, v_produit
    from public.produits p
   where p.tenant_id = p_tenant
     and p.code is not null and btrim(p.code) <> ''
     and lower(regexp_replace(btrim(public.unaccent_simple(p.code)), '\s+', ' ', 'g')) = v_nom;
  if v_combien = 1 then
    return query select v_produit, 'trouve'::text, null::text;
    return;
  elsif v_combien > 1 then
    return query select null::uuid, 'produit_ambigu'::text,
      (v_combien || ' produits portent le code « ' || v_texte
        || ' » (aux accents près) : impossible de savoir lequel décompter.')::text;
    return;
  end if;

  select count(*), min(p.id::text)::uuid into v_combien, v_produit
    from public.produits p
   where p.tenant_id = p_tenant
     and lower(regexp_replace(btrim(public.unaccent_simple(p.product)), '\s+', ' ', 'g')) = v_nom;

  if v_combien = 1 then
    return query select v_produit, 'trouve'::text, null::text;
  elsif v_combien = 0 then
    return query select null::uuid, 'produit_inconnu'::text,
      ('Produit « ' || v_texte || ' » introuvable au catalogue.')::text;
  else
    return query select null::uuid, 'produit_ambigu'::text,
      (v_combien || ' produits portent le nom « ' || v_texte
        || ' » : impossible de savoir lequel décompter.')::text;
  end if;
end;
$function$
;
