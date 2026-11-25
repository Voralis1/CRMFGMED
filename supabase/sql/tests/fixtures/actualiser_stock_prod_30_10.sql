-- actualiser_stock_apres_mouvement de PRODUCTION, lu le 30/10/2026, md5(prosrc) 629880ad79ddad1f658443eab4b9c461 (trigger AFTER INSERT seulement).
CREATE OR REPLACE FUNCTION public.actualiser_stock_apres_mouvement()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Crée la ligne de stock si elle n'existe pas pour cet entrepôt
    INSERT INTO stocks (tenant_id, produit_id, entrepot_id, quantite_disponible, quantite_reservee, quantite_defectueuse)
    VALUES (NEW.tenant_id, NEW.produit_id, NEW.entrepot_id, 0, 0, 0)
    ON CONFLICT (produit_id, entrepot_id) DO NOTHING;

    -- Mise à jour du stock par entrepôt ET de votre table produits globale
    IF NEW.type_mouvement IN ('entree', 'retour_ok', 'ajustement') THEN
        UPDATE stocks SET quantite_disponible = quantite_disponible + NEW.quantite WHERE produit_id = NEW.produit_id AND entrepot_id = NEW.entrepot_id;
        UPDATE produits SET current_quantity = COALESCE(current_quantity, 0) + NEW.quantite WHERE id = NEW.produit_id;
        
    ELSIF NEW.type_mouvement = 'sortie' THEN
        UPDATE stocks SET quantite_disponible = quantite_disponible - NEW.quantite WHERE produit_id = NEW.produit_id AND entrepot_id = NEW.entrepot_id;
        UPDATE produits SET current_quantity = COALESCE(current_quantity, 0) - NEW.quantite WHERE id = NEW.produit_id;
        
    ELSIF NEW.type_mouvement = 'retour_defaut' THEN
        UPDATE stocks SET quantite_defectueuse = quantite_defectueuse + NEW.quantite WHERE produit_id = NEW.produit_id AND entrepot_id = NEW.entrepot_id;
        UPDATE produits SET defected_quantity = COALESCE(defected_quantity, 0) + NEW.quantite WHERE id = NEW.produit_id;
    END IF;

    RETURN NEW;
END;
$function$
;
