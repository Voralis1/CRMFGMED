SET local check_function_bodies = off;

CREATE SEQUENCE "public"."commandes_tracking_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."expeditions_numero_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."reglements_numero_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE TABLE "public"."agents" (
  "id"        uuid    NOT NULL DEFAULT gen_random_uuid(),
  "user_id"   uuid,
  "nom"       text    NOT NULL,
  "pays_id"   uuid,
  "actif"     boolean DEFAULT true,
  "tenant_id" uuid    NOT NULL,
  CONSTRAINT "agents_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."agents"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."appels" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "commande_id"      uuid,
  "agent_id"         uuid,
  "statut"           text                     DEFAULT 'en_attente'::text,
  "notes"            text,
  "date_rappel"      date,
  "created_at"       timestamp with time zone DEFAULT now(),
  "tenant_id"        uuid                     NOT NULL,
  "duree_secondes"   integer,
  "statut_precedent" text,
  CONSTRAINT "appels_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."appels"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."commandes" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "lead_id"             text                     NOT NULL,
  "source"              text,
  "client_nom"          text,
  "client_telephone"    text                     NOT NULL,
  "produit"             text,
  "pays_id"             uuid                     NOT NULL,
  "zone_id"             uuid,
  "statut_confirmation" text,
  "statut_livraison"    text,
  "statut_paiement"     text                     DEFAULT 'non_paye'::text,
  "is_doublon"          boolean                  DEFAULT false,
  "created_at"          timestamp with time zone DEFAULT now(),
  "updated_at"          timestamp with time zone DEFAULT now(),
  "date_commande"       timestamp with time zone,
  "ville_zone"          text,
  "source_url"          text,
  "commentaire_1"       text,
  "whatsapp_tracking"   text,
  "source_sheet"        text,
  "whatsapp_followup"   text,
  "notes"               text,
  "commentaire_2"       text,
  "quantite"            integer                  DEFAULT 1,
  "date_rappel"         timestamp with time zone,
  "prix"                numeric                  DEFAULT 0,
  "tenant_id"           uuid                     NOT NULL,
  "agent_id"            uuid,
  "vendeur_id"          uuid,
  "tracking_number"     text,
  "source_id"           uuid,
  "adresse"             text,
  "entrepot_id"         uuid,
  CONSTRAINT "commandes_lead_id_key" UNIQUE (lead_id),
  CONSTRAINT "commandes_pkey" PRIMARY KEY (id),
  CONSTRAINT "commandes_statut_livraison_valide"
    CHECK (((statut_livraison IS NULL) OR (statut_livraison = ANY (ARRAY['a_preparer'::text, 'expedie'::text, 'livre'::text, 'retour'::text, 'annule'::text])))),
  CONSTRAINT "commandes_statut_paiement_check" CHECK ((statut_paiement = ANY (ARRAY['non_paye'::text, 'en_attente'::text, 'paye'::text])))
);

ALTER TABLE "public"."commandes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."entrepots" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"    uuid                     NOT NULL,
  "nom"          text                     NOT NULL,
  "localisation" text,
  "actif"        boolean                  DEFAULT true,
  "created_at"   timestamp with time zone DEFAULT now(),
  "pays_id"      uuid,
  CONSTRAINT "entrepots_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."entrepots"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."expeditions_produits" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"      uuid                     NOT NULL,
  "expedition_id"  uuid                     NOT NULL,
  "produit_id"     uuid                     NOT NULL,
  "quantite"       integer                  NOT NULL DEFAULT 1,
  "created_at"     timestamp with time zone DEFAULT now(),
  "quantite_recue" integer,
  CONSTRAINT "expeditions_produits_expedition_id_produit_id_key" UNIQUE (expedition_id, produit_id),
  CONSTRAINT "expeditions_produits_pkey" PRIMARY KEY (id),
  CONSTRAINT "expeditions_produits_quantite_check" CHECK ((quantite > 0))
);

ALTER TABLE "public"."expeditions_produits"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."expeditions" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"               uuid                     NOT NULL,
  "reference"               text,
  "vendeur_id"              uuid,
  "poids_kg"                numeric(10,2),
  "mode_transport"          text,
  "details"                 text,
  "transporteur"            text,
  "pays"                    text,
  "date_expedition"         timestamp with time zone,
  "date_reception"          timestamp with time zone,
  "statut"                  text                     NOT NULL DEFAULT 'en_attente'::text,
  "confirme_par"            uuid,
  "confirme_le"             timestamp with time zone,
  "motif_refus"             text,
  "created_at"              timestamp with time zone DEFAULT now(),
  "updated_at"              timestamp with time zone DEFAULT now(),
  "pays_destination_id"     uuid,
  "transporteur_telephone"  text,
  "pays_code"               text,
  "entrepot_destination_id" uuid,
  "entrepot_reception_id"   uuid,
  "recu_par"                uuid,
  CONSTRAINT "expeditions_pkey" PRIMARY KEY (id),
  CONSTRAINT "expeditions_reference_key" UNIQUE (reference),
  CONSTRAINT "expeditions_statut_valide" CHECK ((statut = ANY (ARRAY['en_attente'::text, 'confirmee'::text, 'refusee'::text, 'en_transit'::text, 'receptionnee'::text])))
);

ALTER TABLE "public"."expeditions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."imports_bruts" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   uuid                     NOT NULL,
  "source_id"   uuid,
  "payload"     jsonb                    NOT NULL,
  "statut"      text                     NOT NULL DEFAULT 'recu'::text,
  "motif"       text,
  "cle_externe" text,
  "commande_id" uuid,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "imports_bruts_pkey" PRIMARY KEY (id),
  CONSTRAINT "imports_bruts_statut_valide" CHECK ((statut = ANY (ARRAY['recu'::text, 'importe'::text, 'doublon'::text, 'rejete'::text])))
);

ALTER TABLE "public"."imports_bruts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."livraisons" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "commande_id"     uuid,
  "livreur_id"      uuid,
  "statut"          text                     DEFAULT 'a_preparer'::text,
  "motif_retour_id" uuid,
  "date_livraison"  timestamp with time zone,
  "created_at"      timestamp with time zone DEFAULT now(),
  "motif_retour"    text,
  "tenant_id"       uuid                     NOT NULL,
  CONSTRAINT "livraisons_pkey" PRIMARY KEY (id),
  CONSTRAINT "livraisons_statut_valide" CHECK ((statut = ANY (ARRAY['a_preparer'::text, 'expedie'::text, 'livre'::text, 'retour'::text, 'annule'::text])))
);

ALTER TABLE "public"."livraisons"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."livreurs" (
  "id"        uuid    NOT NULL DEFAULT gen_random_uuid(),
  "user_id"   uuid,
  "nom"       text    NOT NULL,
  "telephone" text,
  "pays_id"   uuid,
  "actif"     boolean DEFAULT true,
  "zone"      text,
  "tenant_id" uuid    NOT NULL,
  CONSTRAINT "livreurs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."livreurs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."motifs_retour" (
  "id"      uuid NOT NULL DEFAULT gen_random_uuid(),
  "libelle" text NOT NULL,
  CONSTRAINT "motifs_retour_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."motifs_retour"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."mouvements_stock" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"      uuid                     NOT NULL,
  "produit_id"     uuid,
  "entrepot_id"    uuid,
  "type_mouvement" text,
  "quantite"       integer                  NOT NULL,
  "notes"          text,
  "created_at"     timestamp with time zone DEFAULT now(),
  CONSTRAINT "mouvements_stock_pkey" PRIMARY KEY (id),
  CONSTRAINT "mouvements_stock_type_mouvement_check"
    CHECK ((type_mouvement = ANY (ARRAY['entree'::text, 'sortie'::text, 'retour_ok'::text, 'retour_defaut'::text, 'ajustement'::text])))
);

ALTER TABLE "public"."mouvements_stock"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."paiements" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "commande_id"       uuid,
  "livreur_id"        uuid,
  "montant"           numeric,
  "methode"           text                     DEFAULT 'cod'::text,
  "statut"            text                     DEFAULT 'en_attente'::text,
  "date_encaissement" timestamp with time zone,
  "created_at"        timestamp with time zone DEFAULT now(),
  "tenant_id"         uuid                     NOT NULL,
  CONSTRAINT "paiements_pkey" PRIMARY KEY (id),
  CONSTRAINT "paiements_statut_check" CHECK ((statut = ANY (ARRAY['en_attente'::text, 'encaisse'::text, 'remis'::text])))
);

ALTER TABLE "public"."paiements"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."pays" (
  "id"        uuid NOT NULL DEFAULT gen_random_uuid(),
  "nom"       text NOT NULL,
  "code"      text,
  "devise"    text,
  "tenant_id" uuid NOT NULL,
  CONSTRAINT "pays_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."pays"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."permissions" (
  "code"        text NOT NULL,
  "nom"         text NOT NULL,
  "module"      text NOT NULL,
  "description" text,
  CONSTRAINT "permissions_pkey" PRIMARY KEY (code)
);

ALTER TABLE "public"."permissions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."produits" (
  "id"                   uuid                     NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "product"              text                     NOT NULL,
  "price"                numeric                  NOT NULL DEFAULT 0,
  "description"          text,
  "seller"               text,
  "code"                 text,
  "current_quantity"     integer                  DEFAULT 0,
  "defected_quantity"    integer                  DEFAULT 0,
  "upsell"               text,
  "product_page"         text,
  "created_at"           timestamp with time zone DEFAULT now(),
  "tenant_id"            uuid                     NOT NULL,
  "type"                 text                     DEFAULT 'Standard'::text,
  "quantite_totale"      integer                  DEFAULT 0,
  "crosssell"            text,
  "statut"               text                     DEFAULT 'actif'::text,
  "code_variante"        text,
  "upsell_produit_id"    uuid,
  "crosssell_produit_id" uuid,
  CONSTRAINT "produits_crosssell_pas_soi_meme" CHECK (((crosssell_produit_id IS NULL) OR (crosssell_produit_id <> id))),
  CONSTRAINT "produits_pkey" PRIMARY KEY (id),
  CONSTRAINT "produits_statut_valide" CHECK ((statut = ANY (ARRAY['actif'::text, 'inactif'::text]))),
  CONSTRAINT "produits_upsell_pas_soi_meme" CHECK (((upsell_produit_id IS NULL) OR (upsell_produit_id <> id)))
);

ALTER TABLE "public"."produits"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reglements_commandes" (
  "commande_id"  uuid          NOT NULL,
  "reglement_id" uuid          NOT NULL,
  "tenant_id"    uuid          NOT NULL,
  "montant"      numeric(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT "reglements_commandes_pkey" PRIMARY KEY (commande_id)
);

ALTER TABLE "public"."reglements_commandes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reglements" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"          uuid                     NOT NULL,
  "reference"          text,
  "vendeur_id"         uuid,
  "periode_debut"      date                     NOT NULL,
  "periode_fin"        date                     NOT NULL,
  "date_paiement"      timestamp with time zone,
  "methode"            text                     DEFAULT 'especes'::text,
  "devise"             text,
  "nb_commandes"       integer                  NOT NULL DEFAULT 0,
  "total_ventes"       numeric(12,2)            NOT NULL DEFAULT 0,
  "frais_confirmation" numeric(12,2)            NOT NULL DEFAULT 0,
  "frais_livraison"    numeric(12,2)            NOT NULL DEFAULT 0,
  "frais_service"      numeric(12,2)            NOT NULL DEFAULT 0,
  "frais_divers"       numeric(12,2)            NOT NULL DEFAULT 0,
  "net_a_payer"        numeric(12,2)            NOT NULL DEFAULT 0,
  "statut"             text                     NOT NULL DEFAULT 'en_attente'::text,
  "note"               text,
  "cree_par"           uuid,
  "created_at"         timestamp with time zone DEFAULT now(),
  CONSTRAINT "reglements_check" CHECK ((periode_fin >= periode_debut)),
  CONSTRAINT "reglements_methode_valide" CHECK ((methode = ANY (ARRAY['especes'::text, 'virement'::text, 'cheque'::text]))),
  CONSTRAINT "reglements_pkey" PRIMARY KEY (id),
  CONSTRAINT "reglements_reference_key" UNIQUE (reference),
  CONSTRAINT "reglements_statut_valide" CHECK ((statut = ANY (ARRAY['en_attente'::text, 'paye'::text, 'annule'::text])))
);

ALTER TABLE "public"."reglements"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."role_permissions" (
  "role_id"         uuid NOT NULL,
  "permission_code" text NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY (role_id, permission_code)
);

ALTER TABLE "public"."role_permissions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."roles" (
  "id"          uuid    NOT NULL DEFAULT gen_random_uuid(),
  "nom"         text    NOT NULL,
  "is_system"   boolean DEFAULT false,
  "tenant_id"   uuid,
  "description" text,
  CONSTRAINT "roles_nom_tenant_id_key" UNIQUE (nom, tenant_id),
  CONSTRAINT "roles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."roles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."sources_import" (
  "id"                    uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"             uuid                     NOT NULL,
  "nom"                   text                     NOT NULL,
  "type"                  text                     NOT NULL DEFAULT 'webhook'::text,
  "vendeur_id"            uuid,
  "actif"                 boolean                  NOT NULL DEFAULT true,
  "token_hash"            text,
  "token_apercu"          text,
  "spreadsheet_id"        text,
  "onglet"                text                     DEFAULT 'Feuille 1'::text,
  "mapping"               jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "dernier_modified_time" text,
  "derniere_sync"         timestamp with time zone,
  "derniere_erreur"       text,
  "nb_importees"          integer                  NOT NULL DEFAULT 0,
  "nb_rejetees"           integer                  NOT NULL DEFAULT 0,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"            uuid,
  CONSTRAINT "sources_import_config_complete" CHECK ((((type = 'webhook'::text) AND (token_hash IS NOT NULL)) OR ((type = 'google_sheet'::text) AND (spreadsheet_id IS NOT NULL)))),
  CONSTRAINT "sources_import_pkey" PRIMARY KEY (id),
  CONSTRAINT "sources_import_token_hash_key" UNIQUE (token_hash),
  CONSTRAINT "sources_import_type_valide" CHECK ((type = ANY (ARRAY['webhook'::text, 'google_sheet'::text])))
);

ALTER TABLE "public"."sources_import"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."statuts" (
  "id"                    uuid    NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "nom"                   text    NOT NULL,
  "couleur"               text    DEFAULT '#2C3B4D'::text,
  "type"                  text    DEFAULT 'appel'::text,
  "pays_id"               uuid,
  "tenant_id"             uuid,
  "declenche_assignation" boolean NOT NULL DEFAULT false,
  "code"                  text    NOT NULL,
  "necessite_rappel"      boolean NOT NULL DEFAULT false,
  "ferme_le_lead"         boolean NOT NULL DEFAULT false,
  CONSTRAINT "statuts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."statuts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."stocks" (
  "id"                   uuid    NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"            uuid    NOT NULL,
  "produit_id"           uuid,
  "entrepot_id"          uuid,
  "quantite_disponible"  integer DEFAULT 0,
  "quantite_reservee"    integer DEFAULT 0,
  "quantite_defectueuse" integer DEFAULT 0,
  CONSTRAINT "stocks_pkey" PRIMARY KEY (id),
  CONSTRAINT "stocks_produit_id_entrepot_id_key" UNIQUE (produit_id, entrepot_id)
);

ALTER TABLE "public"."stocks"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tenants" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "nom_entreprise" text                     NOT NULL,
  "created_at"     timestamp with time zone DEFAULT timezone('utc'::text, now()),
  "statut"         text                     NOT NULL DEFAULT 'actif'::text,
  CONSTRAINT "tenants_pkey" PRIMARY KEY (id),
  CONSTRAINT "tenants_statut_check" CHECK ((statut = ANY (ARRAY['actif'::text, 'suspendu'::text, 'archive'::text])))
);

ALTER TABLE "public"."tenants"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."user_roles" (
  "user_id"    uuid                     NOT NULL,
  "role"       text,
  "tenant_id"  uuid                     NOT NULL,
  "role_id"    uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "email"      text,
  "nom"        text,
  CONSTRAINT "user_roles_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "public"."user_roles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."user_roles" FROM "anon";

CREATE TABLE "public"."zones" (
  "id"              uuid    NOT NULL DEFAULT gen_random_uuid(),
  "pays_id"         uuid,
  "ville"           text,
  "nom_zone"        text,
  "frais_livraison" numeric DEFAULT 0,
  "frais_retour"    numeric DEFAULT 0,
  "tenant_id"       uuid    NOT NULL,
  CONSTRAINT "zones_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."zones"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.actualiser_stock_apres_mouvement()
  RETURNS TRIGGER
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
$function$;

CREATE OR REPLACE FUNCTION public.assigner_lead_automatiquement()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
DECLARE
    agent_cible_id UUID;
BEGIN
    -- Si un manager a déjà défini un agent manuellement lors de l'import, on ne fait rien
    IF NEW.agent_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Algorithme : Trouver l'agent actif du même tenant qui a le MOINS de leads "non traités"
    SELECT a.id INTO agent_cible_id
    FROM agents a
    -- On compte uniquement les commandes que l'agent n'a pas encore appelées (statut_confirmation IS NULL)
    LEFT JOIN commandes c ON c.agent_id = a.id AND c.statut_confirmation IS NULL
    WHERE a.tenant_id = NEW.tenant_id
      AND a.actif = true -- L'agent doit être actif
    GROUP BY a.id
    ORDER BY COUNT(c.id) ASC -- On trie du plus petit nombre de leads au plus grand
    LIMIT 1; -- On prend le premier (le moins chargé)

    -- Si on a trouvé un agent disponible, on lui affecte la commande
    IF agent_cible_id IS NOT NULL THEN
        NEW.agent_id := agent_cible_id;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attribuer_tracking()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  -- On ne réécrit jamais un numéro déjà là : un import qui apporte le numéro
  -- du transporteur garde le sien.
  if new.tracking_number is null or btrim(new.tracking_number) = '' then
    new.tracking_number := 'FG' || lpad(nextval('public.commandes_tracking_seq')::text, 10, '0');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.auto_affecter_agent()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.agent_id is null and new.pays_id is not null then
    new.agent_id := public.choisir_agent(new.tenant_id, new.pays_id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.auto_affecter_livreur()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_livreur uuid;
  v_declenche boolean;
begin
  if new.statut_confirmation is null then return new; end if;

  if tg_op = 'UPDATE'
     and new.statut_confirmation is not distinct from old.statut_confirmation then
    return new;
  end if;

  select coalesce(bool_or(s.declenche_assignation), false) into v_declenche
  from public.statuts s
  where s.tenant_id = new.tenant_id
    and (s.nom = new.statut_confirmation or s.code = new.statut_confirmation)
    and (s.pays_id is null or s.pays_id = new.pays_id);

  if not v_declenche then return new; end if;

  if exists (select 1 from public.livraisons v where v.commande_id = new.id) then
    return new;
  end if;

  v_livreur := public.choisir_livreur(new.tenant_id, new.pays_id, new.ville_zone);

  if v_livreur is not null then
    insert into public.livraisons (commande_id, livreur_id, tenant_id, statut)
    values (new.id, v_livreur, new.tenant_id, 'en_attente');
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_agent_pays()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_role text;
begin
  select lower(ur.role) into v_role
  from public.user_roles ur
  where ur.user_id = new.user_id;

  if v_role = 'agent' then
    if new.pays_id is null then
      raise exception 'Un agent doit avoir un pays (pays_id).';
    end if;
    if not exists (
      select 1 from public.pays p
      where p.id = new.pays_id and p.tenant_id = new.tenant_id
    ) then
      raise exception 'Ce pays n''appartient pas à l''entreprise de l''agent.';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_fiche_tenant()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare t_compte uuid;
begin
  if new.user_id is null then return new; end if;
  select tenant_id into t_compte from public.user_roles where user_id = new.user_id;
  if t_compte is not null and t_compte is distinct from new.tenant_id then
    raise exception 'La fiche et le compte doivent appartenir à la même entreprise';
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.check_livraison_coherente()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare t_livreur uuid; t_commande uuid;
begin
  select tenant_id into t_livreur  from public.livreurs  where id = new.livreur_id;
  select tenant_id into t_commande from public.commandes where id = new.commande_id;
  if t_livreur is distinct from new.tenant_id or t_commande is distinct from new.tenant_id then
    raise exception 'Livreur ou commande d''une autre entreprise';
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.check_livreur_pays()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.user_id is null then
    return new;
  end if;

  if new.pays_id is null then
    raise exception 'Un livreur doit avoir un pays (pays_id).';
  end if;
  if not exists (select 1 from public.pays p where p.id = new.pays_id and p.tenant_id = new.tenant_id) then
    raise exception 'Ce pays n''appartient pas à l''entreprise du livreur.';
  end if;

  if (new.zone is null or btrim(new.zone) = '') and coalesce(new.actif, true) then
    raise exception 'Un livreur actif doit avoir une zone.';
  end if;

  if new.zone is not null and btrim(new.zone) <> ''
     and (tg_op = 'INSERT'
          or new.zone is distinct from old.zone
          or new.pays_id is distinct from old.pays_id) then
    if not exists (
      select 1 from public.zones z
      where z.tenant_id = new.tenant_id and z.pays_id = new.pays_id and z.nom_zone = btrim(new.zone)
    ) then
      raise exception 'Cette zone n''existe pas dans ce pays.';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.choisir_agent (
  p_tenant uuid,
  p_pays   uuid
)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select a.id
  from public.agents a
  join public.user_roles ur on ur.user_id = a.user_id
  where a.tenant_id = p_tenant
    and a.pays_id = p_pays          
    and a.actif = true
    and lower(ur.role) = 'agent'
  order by
    (select count(*) from public.commandes c
      where c.agent_id = a.id and c.statut_confirmation is null),
    random()
  limit 1
$function$;

REVOKE ALL ON FUNCTION "public"."choisir_agent"(uuid, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.choisir_livreur (
  p_tenant  uuid,
  p_pays    uuid,
  p_ville   text,
  p_exclure uuid DEFAULT NULL::uuid
)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select l.id
  from public.livreurs l
  where l.tenant_id = p_tenant
    and l.pays_id = p_pays
    and l.actif = true
    and l.user_id is not null
    and (p_exclure is null or l.id <> p_exclure)
    and l.zone is not null and btrim(l.zone) <> ''
    and p_ville is not null
    and lower(p_ville) like '%' || lower(btrim(l.zone)) || '%'
  order by
    (select count(*) from public.livraisons v
      where v.livreur_id = l.id and v.statut = 'en_attente'),
    random()
  limit 1
$function$;

REVOKE ALL ON FUNCTION "public"."choisir_livreur"(uuid, uuid, text, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.commande_de_mon_agent (
  p_commande uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (select 1 from public.commandes c
                 join public.agents a on a.id = c.agent_id
                 where c.id = p_commande and a.user_id = auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.commande_de_mon_seller (
  p_commande uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (select 1 from public.commandes c
                 where c.id = p_commande and c.vendeur_id = auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.debug_auth_uid()
  RETURNS uuid
  LANGUAGE sql
  AS $function$
  select auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.debug_check_definer()
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  AS $function$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.debug_check_invoker()
  RETURNS boolean
  LANGUAGE sql
  AS $function$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.est_ma_livraison (
  p_commande uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.livraisons l
    join public.livreurs lv on lv.id = l.livreur_id
    where l.commande_id = p_commande and lv.user_id = auth.uid()
  )
$function$;

CREATE OR REPLACE FUNCTION public.est_responsable()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select public.mon_role() in ('admin', 'ceo', 'manager')
$function$;

CREATE OR REPLACE FUNCTION public.expedition_modifiable (
  p_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.expeditions e
     where e.id = p_id
       and (
         public.is_super_admin()
         or (e.tenant_id = public.get_my_tenant_id()
             and (
               lower(coalesce(public.mon_role(), '')) in ('admin', 'manager')
               or (lower(coalesce(public.mon_role(), '')) = 'seller'
                   and e.vendeur_id = auth.uid()
                   and e.statut = 'en_attente')
             ))
       )
  )
$function$;

CREATE OR REPLACE FUNCTION public.expedition_reception_figee()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  -- Service role et éditeur SQL : `auth.uid()` est NULL, le garde se retire.
  -- La base se protège de l'application, pas de son administrateur.
  if auth.uid() is null then
    return new;
  end if;

  if old.statut = 'receptionnee'
     and new.statut is distinct from old.statut
     and not public.is_super_admin() then
    raise exception 'Une expédition réceptionnée ne revient pas en arrière : corrigez par un mouvement de stock';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.expedition_visible (
  p_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.expeditions e
     where e.id = p_id
       and (
         public.is_super_admin()
         or (e.tenant_id = public.get_my_tenant_id()
             and (public.est_responsable() or e.vendeur_id = auth.uid()))
       )
  )
$function$;

CREATE OR REPLACE FUNCTION public.expeditions_garde()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_responsable boolean;
begin
  -- Clé service_role, éditeur SQL, cascade interne : auth.uid() est NULL et il
  -- n'y a personne à contrôler. Sans cette ligne, les scripts d'administration
  -- se retrouvent bloqués par une règle écrite pour les humains.
  if auth.uid() is null then
    return new;
  end if;

  v_responsable := public.is_super_admin()
                   or lower(coalesce(public.mon_role(), '')) in ('admin', 'manager');

  if tg_op = 'INSERT' then
    if not v_responsable then
      new.statut       := 'en_attente';
      new.confirme_par := null;
      new.confirme_le  := null;
      new.motif_refus  := null;
      new.vendeur_id   := auth.uid();   -- on ne dépose pas au nom d'un autre
    end if;
    return new;
  end if;

  -- UPDATE
  if not v_responsable then
    if old.statut <> 'en_attente' then
      raise exception 'Cette expédition a déjà été traitée : elle ne peut plus être modifiée';
    end if;
    if new.statut is distinct from old.statut then
      raise exception 'Seul un admin ou un manager peut confirmer ou refuser une expédition';
    end if;
    if new.vendeur_id is distinct from old.vendeur_id
       or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Une expédition ne change ni de vendeur ni d''entreprise';
    end if;
    -- On remet la décision telle qu'elle était, au cas où elle serait envoyée.
    new.confirme_par := old.confirme_par;
    new.confirme_le  := old.confirme_le;
    new.motif_refus  := old.motif_refus;
  else
    -- Le responsable tranche : on note qui et quand, sans le lui demander.
    if new.statut is distinct from old.statut and new.statut in ('confirmee', 'refusee') then
      new.confirme_par := auth.uid();
      new.confirme_le  := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.expeditions_reference()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.reference is null or new.reference = '' then
    new.reference := 'EXP-' || lpad(nextval('public.expeditions_numero_seq')::text, 6, '0');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ajuster_stock_livraison()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
DECLARE
  v_produit_nom   TEXT;
  v_quantite      INTEGER;
  v_tenant_id     UUID;
  v_produit_id    UUID;
BEGIN
  -- Rien à faire si le statut n'a pas changé (évite les ajustements en double)
  IF TG_OP = 'UPDATE' AND OLD.statut IS NOT DISTINCT FROM NEW.statut THEN
    RETURN NEW;
  END IF;

  -- Récupère les infos de la commande liée à cette livraison
  SELECT produit, quantite, tenant_id
    INTO v_produit_nom, v_quantite, v_tenant_id
  FROM commandes
  WHERE id = NEW.commande_id;

  -- Pas assez d'info pour ajuster le stock (commande introuvable, produit vide, quantité vide)
  IF v_produit_nom IS NULL OR v_quantite IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cherche le produit correspondant dans le catalogue (matching texte tolérant)
  SELECT id INTO v_produit_id
  FROM produits
  WHERE LOWER(TRIM(product)) = LOWER(TRIM(v_produit_nom))
    AND tenant_id = v_tenant_id
  LIMIT 1;

  -- Produit introuvable dans le catalogue → rien à ajuster (mais la livraison n'est pas bloquée)
  IF v_produit_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Livraison confirmée : on retire du stock
  IF NEW.statut = 'livre' AND (TG_OP = 'INSERT' OR OLD.statut IS DISTINCT FROM 'livre') THEN
    UPDATE produits
    SET current_quantity = GREATEST(COALESCE(current_quantity, 0) - v_quantite, 0)
    WHERE id = v_produit_id;
  END IF;

  -- Retour après une livraison qui était confirmée : on remet en stock
  IF TG_OP = 'UPDATE' AND OLD.statut = 'livre' AND NEW.statut IS DISTINCT FROM 'livre' THEN
    UPDATE produits
    SET current_quantity = COALESCE(current_quantity, 0) + v_quantite
    WHERE id = v_produit_id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gere_la_config()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select public.is_super_admin()
      or lower(coalesce(public.mon_role(), '')) in ('admin', 'manager')
$function$;

CREATE OR REPLACE FUNCTION public.get_mes_permissions()
  RETURNS text[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
DECLARE
    permissions_array text[];
BEGIN
    SELECT array_agg(rp.permission_code)
    INTO permissions_array
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role_id = rp.role_id
    WHERE ur.user_id = auth.uid();
    
    RETURN COALESCE(permissions_array, ARRAY[]::text[]);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select tenant_id from public.user_roles where user_id = auth.uid() limit 1
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.user_roles ur
    left join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and (ur.role = 'super_admin' or r.nom = 'super_admin')
  )
$function$;

CREATE OR REPLACE FUNCTION public.mon_agent_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select id from public.agents where user_id = auth.uid() limit 1
$function$;

CREATE OR REPLACE FUNCTION public.mon_livreur_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select id from public.livreurs where user_id = auth.uid() limit 1
$function$;

CREATE OR REPLACE FUNCTION public.mon_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(
    (select r.nom from public.user_roles ur
       join public.roles r on r.id = ur.role_id
      where ur.user_id = auth.uid() limit 1),
    (select ur.role from public.user_roles ur where ur.user_id = auth.uid() limit 1)
  )
$function$;

CREATE OR REPLACE FUNCTION public.pays_du_produit (
  p_produit uuid
)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select distinct e.pays_id
  from public.stocks s
  join public.entrepots e on e.id = s.entrepot_id
  where s.produit_id = p_produit
    and e.pays_id is not null
    -- Le contrôle d'entreprise, à la main : en SECURITY DEFINER il n'y a plus
    -- de RLS pour le faire.
    and (
      public.is_super_admin()
      or s.tenant_id = public.get_my_tenant_id()
    )
$function$;

CREATE OR REPLACE FUNCTION public.protege_fiche_agent()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  -- back-office : service key, suppression d'un compte, SQL editor
  if auth.uid() is null then
    return new;
  end if;

  if public.is_super_admin() or public.est_responsable() then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.tenant_id is distinct from old.tenant_id
     or new.pays_id is distinct from old.pays_id
     or new.actif is distinct from old.actif then
    raise exception 'Un agent ne peut pas modifier son pays, son statut ni son entreprise';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protege_fiche_livreur()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_super_admin() or public.est_responsable() then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.tenant_id is distinct from old.tenant_id
     or new.pays_id is distinct from old.pays_id
     or new.zone is distinct from old.zone
     or new.actif is distinct from old.actif then
    raise exception 'Un livreur ne peut pas modifier sa zone, son pays, son statut ni son entreprise';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rattacher_produit_pays (
  p_produit uuid,
  p_pays    uuid[]
)
  RETURNS TABLE (
    ajoutes       integer,
    retires       integer,
    gardes_pleins integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_tenant uuid;
  v_pays   uuid[] := coalesce(p_pays, '{}'::uuid[]);
begin
  -- L'entreprise du produit, pas celle que l'appelant prétend.
  select tenant_id into v_tenant from public.produits where id = p_produit;
  if v_tenant is null then
    raise exception 'Produit introuvable';
  end if;

  if not (public.is_super_admin() or v_tenant = public.get_my_tenant_id()) then
    raise exception 'Ce produit n''appartient pas à votre entreprise';
  end if;

  -- Les pays doivent être ceux de l'entreprise, et avoir un entrepôt. Un
  -- identifiant venu d'ailleurs est ignoré, pas refusé : il ne correspond à
  -- aucun entrepôt, donc il ne crée rien.
  with vise as (
    select e.id as entrepot_id
    from public.entrepots e
    where e.tenant_id = v_tenant
      and e.pays_id = any (v_pays)
  ),
  nouveaux as (
    insert into public.stocks (tenant_id, produit_id, entrepot_id,
                               quantite_disponible, quantite_defectueuse)
    select v_tenant, p_produit, v.entrepot_id, 0, 0
    from vise v
    where not exists (
      select 1 from public.stocks s
      where s.produit_id = p_produit and s.entrepot_id = v.entrepot_id
    )
    returning 1
  )
  select count(*)::int into ajoutes from nouveaux;

  -- À retirer : les lignes de ce produit dont l'entrepôt n'est plus dans les
  -- pays choisis. On sépare les vides des pleines.
  with a_retirer as (
    select s.id, (s.quantite_disponible > 0 or s.quantite_defectueuse > 0) as plein
    from public.stocks s
    join public.entrepots e on e.id = s.entrepot_id
    where s.produit_id = p_produit
      and s.tenant_id = v_tenant
      and (e.pays_id is null or not (e.pays_id = any (v_pays)))
  ),
  supprimees as (
    delete from public.stocks
    where id in (select id from a_retirer where not plein)
    returning 1
  )
  select
    (select count(*)::int from supprimees),
    (select count(*)::int from a_retirer where plein)
  into retires, gardes_pleins;

  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.receptionner_expedition (
  p_expedition uuid,
  p_date       timestamp with time zone,
  p_entrepot   uuid,
  p_lignes     jsonb
)
  RETURNS TABLE (
    lignes          integer,
    total_declare   integer,
    total_recu      integer,
    ecart           integer,
    entrepot_retenu uuid
  )
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

  if not (public.is_super_admin() or (v_exp.tenant_id = public.get_my_tenant_id() and public.gere_la_config())) then
    raise exception 'Seuls le manager et l''administrateur enregistrent une réception';
  end if;

  -- On ne reçoit que ce qui est parti. Recevoir une expédition encore en
  -- attente ferait entrer en stock une marchandise que personne n'a validée.
  if v_exp.statut not in ('confirmee', 'en_transit') then
    raise exception 'Une expédition « % » ne peut pas être réceptionnée', v_exp.statut;
  end if;

  -- Le dépôt : celui qu'on passe, sinon celui de la destination, sinon le
  -- seul entrepôt du pays visé. Le vendeur n'a choisi qu'un pays — c'est au
  -- responsable de dire où ça atterrit, et s'il n'y a qu'un dépôt dans ce
  -- pays, il n'y a rien à demander.
  v_entrepot := coalesce(p_entrepot, v_exp.entrepot_destination_id);

  if v_entrepot is null then
    v_pays := v_exp.pays_destination_id;
    if v_pays is null and v_exp.pays_code is not null then
      select id into v_pays from public.pays
       where tenant_id = v_exp.tenant_id and upper(btrim(code)) = upper(btrim(v_exp.pays_code))
       limit 1;
    end if;

    select count(*) into v_nb from public.entrepots
     where tenant_id = v_exp.tenant_id and pays_id = v_pays;

    if v_nb = 0 then
      raise exception 'Aucun entrepôt dans le pays de destination : créez-le d''abord';
    elsif v_nb > 1 then
      raise exception 'Plusieurs entrepôts dans ce pays : précisez lequel reçoit';
    end if;

    select id into v_entrepot from public.entrepots
     where tenant_id = v_exp.tenant_id and pays_id = v_pays;
  end if;

  -- L'entrepôt retenu doit appartenir à l'entreprise de l'expédition, même
  -- quand il est passé en argument : sinon on ferait entrer du stock chez
  -- quelqu'un d'autre.
  if not exists (
    select 1 from public.entrepots
     where id = v_entrepot and tenant_id = v_exp.tenant_id
  ) then
    raise exception 'Cet entrepôt n''appartient pas à l''entreprise de l''expédition';
  end if;

  -- Les quantités reçues, ligne par ligne. Une ligne absente de `p_lignes`
  -- est considérée comme reçue en entier : ne rien toucher à une ligne
  -- oubliée vaut mieux que la mettre à zéro en silence.
  for l in
    select ep.id, ep.produit_id, ep.quantite,
           coalesce(
             (select (x->>'quantite_recue')::int
                from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) x
               where (x->>'id')::uuid = ep.id),
             ep.quantite
           ) as recue
    from public.expeditions_produits ep
    where ep.expedition_id = p_expedition
  loop
    if l.recue < 0 then
      raise exception 'Une quantité reçue ne peut pas être négative';
    end if;

    update public.expeditions_produits
       set quantite_recue = l.recue
     where id = l.id;

    -- Zéro reçu : l'écart est enregistré, mais aucun mouvement. Un mouvement
    -- à zéro créerait une ligne de stock pour une marchandise jamais arrivée.
    if l.recue > 0 and l.produit_id is not null then
      insert into public.mouvements_stock
        (tenant_id, produit_id, entrepot_id, type_mouvement, quantite, notes)
      values
        (v_exp.tenant_id, l.produit_id, v_entrepot, 'entree', l.recue,
         'Réception expédition ' || coalesce(v_exp.reference, '?'));
    end if;
  end loop;

  -- Le total cumulé du produit : le trigger ne le tient pas, il ne s'occupe
  -- que du stock disponible. « Total » dans Produits veut dire « passé chez
  -- nous depuis le début », donc il monte à l'entrée et ne redescend jamais.
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
     set statut                = 'receptionnee',
         date_reception        = coalesce(p_date, now()),
         entrepot_reception_id = v_entrepot,
         recu_par              = auth.uid()
   where id = p_expedition;

  return query
    select count(*)::int,
           coalesce(sum(ep.quantite), 0)::int,
           coalesce(sum(ep.quantite_recue), 0)::int,
           (coalesce(sum(ep.quantite), 0) - coalesce(sum(ep.quantite_recue), 0))::int,
           v_entrepot
      from public.expeditions_produits ep
     where ep.expedition_id = p_expedition;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reglement_modifiable (
  p_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.reglements r
     where r.id = p_id
       and (is_super_admin()
            or (r.tenant_id = get_my_tenant_id()
                and lower(coalesce(mon_role(), '')) in ('admin', 'manager')))
  )
$function$;

CREATE OR REPLACE FUNCTION public.reglement_visible (
  p_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.reglements r
     where r.id = p_id
       and (is_super_admin()
            or (r.tenant_id = get_my_tenant_id()
                and (est_responsable() or r.vendeur_id = auth.uid())))
  )
$function$;

CREATE OR REPLACE FUNCTION public.reglements_garde()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.uid() is null then
    return new;   -- service_role, éditeur SQL : personne à contrôler
  end if;

  if tg_op = 'UPDATE' and old.statut = 'paye' then
    if new.total_ventes   is distinct from old.total_ventes
       or new.net_a_payer is distinct from old.net_a_payer
       or new.nb_commandes is distinct from old.nb_commandes
       or new.vendeur_id  is distinct from old.vendeur_id
       or new.periode_debut is distinct from old.periode_debut
       or new.periode_fin   is distinct from old.periode_fin then
      raise exception 'Ce relevé est déjà payé : ses montants ne peuvent plus changer';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.statut = 'paye' and old.statut <> 'paye'
     and new.date_paiement is null then
    new.date_paiement := now();
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reglements_lignes_garde()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_statut text;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  select r.statut into v_statut from public.reglements r
   where r.id = coalesce(new.reglement_id, old.reglement_id);

  if v_statut = 'paye' then
    raise exception 'Ce relevé est déjà payé : ses commandes ne peuvent plus changer';
  end if;

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reglements_reference()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.reference is null or new.reference = '' then
    new.reference := 'REG-' || lpad(nextval('public.reglements_numero_seq')::text, 6, '0');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_id()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
BEGIN
  -- Si le tenant_id n'est pas envoyé par React (ce qui est le cas actuellement)
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id 
    FROM public.user_roles 
    WHERE user_id = auth.uid() 
    LIMIT 1;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_id_auto()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := get_my_tenant_id();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.source_m_appartient (
  p_source uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.sources_import s
    where s.id = p_source and s.vendeur_id = auth.uid()
  )
$function$;

CREATE OR REPLACE FUNCTION public.stats_dashboard (
  p_tenant uuid,
  p_debut  timestamp with time zone,
  p_fin    timestamp with time zone
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'public'
  AS $function$
declare
  resultat jsonb;
begin
  return (
    with st as (
      select s.nom, s.code,
             coalesce(s.declenche_assignation, false) as confirme,
             coalesce(s.necessite_rappel, false)      as rappel
      from public.statuts s
      where s.tenant_id = p_tenant
    ),
    cmd as (
      select c.*,
             coalesce(c.created_at, c.date_commande::timestamptz) as moment
      from public.commandes c
      where c.tenant_id = p_tenant
    ),
    cmd_periode as (
      select * from cmd where moment >= p_debut and moment <= p_fin
    ),
    classe as (
      select c.*,
        case
          when c.statut_confirmation is null then 'en_attente'
          when exists (select 1 from st
                       where (st.nom = c.statut_confirmation or st.code = c.statut_confirmation)
                         and st.confirme) then 'confirmee'
          when exists (select 1 from st
                       where (st.nom = c.statut_confirmation or st.code = c.statut_confirmation)
                         and st.rappel) then 'rappel'
          when c.statut_confirmation ~* '(annul|cancel)'            then 'annulee'
          when c.statut_confirmation ~* '(injoign|unreach|unrech)'  then 'injoignable'
          else 'autre'
        end as classe
      from cmd_periode c
    ),
    liv as (
      select v.*,
        case
          when lower(coalesce(v.statut, 'en_attente')) in ('livre', 'livree', 'livrée') then 'livre'
          when lower(coalesce(v.statut, 'en_attente')) ~ 'expedi'                       then 'en_attente'
          else lower(coalesce(v.statut, 'en_attente'))
        end as statut_propre
      from public.livraisons v
      where v.tenant_id = p_tenant
        and v.created_at >= p_debut and v.created_at <= p_fin
    ),
    -- un appel par commande : sinon un agent qui rappelle 3 fois compte 3 fois
    appel_cmd as (
      select distinct on (a.commande_id) a.commande_id, a.agent_id
      from public.appels a
      where a.tenant_id = p_tenant
        and a.created_at >= p_debut and a.created_at <= p_fin
      order by a.commande_id, a.created_at
    ),
    nb_appels as (
      select a.agent_id, count(*)::int as appels
      from public.appels a
      where a.tenant_id = p_tenant
        and a.created_at >= p_debut and a.created_at <= p_fin
      group by a.agent_id
    ),
    par_agent as (
      select
        ac.agent_id,
        count(*) filter (where cl.classe = 'confirmee')   ::int as confirmees,
        count(*) filter (where cl.classe = 'injoignable') ::int as injoignables,
        count(*) filter (where cl.classe = 'annulee')     ::int as annulees,
        count(*) filter (where cl.classe = 'rappel')      ::int as reprogrammees,
        count(*) filter (where cl.id in (select commande_id from liv where statut_propre = 'livre'))::int as livrees
      from appel_cmd ac
      join classe cl on cl.id = ac.commande_id
      group by ac.agent_id
    )
    select jsonb_build_object(

      'kpis', jsonb_build_object(
        'commandesTotal', (select count(*) from cmd_periode),
        'commandesJour',  (select count(*) from cmd
                           where moment >= date_trunc('day', now())),
        'tauxConfirmation', coalesce(round(
            100.0 * (select count(*) from classe where classe = 'confirmee')
                  / nullif((select count(*) from classe), 0), 1), 0),
        'tauxLivraison', coalesce(round(
            100.0 * (select count(*) from liv where statut_propre = 'livre')
                  / nullif((select count(*) from liv), 0), 1), 0)
      ),

      'caEncaisseListe', coalesce((
        select jsonb_agg(x order by x->>'total' desc)
        from (
          select jsonb_build_object(
                   'devise', coalesce(pa.devise, 'N/A'),
                   'total',  sum(p.montant)
                 ) as x
          from public.paiements p
          left join public.commandes c on c.id = p.commande_id
          left join public.pays pa     on pa.id = c.pays_id
          where p.tenant_id = p_tenant
            and p.statut in ('en_attente', 'encaisse', 'remis')
            and p.created_at >= p_debut and p.created_at <= p_fin
          group by coalesce(pa.devise, 'N/A')
        ) s
      ), '[]'::jsonb),

      'confirmationParHeure', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'heure', h,
                 'confirmees', coalesce(c.nb_conf, 0),
                 'annulees',   coalesce(c.nb_ann, 0)) order by h)
        from generate_series(0, 23) as h
        left join (
          select extract(hour from coalesce(updated_at, moment))::int as heure,
                 count(*) filter (where classe = 'confirmee') as nb_conf,
                 count(*) filter (where classe = 'annulee')   as nb_ann
          from classe group by 1
        ) c on c.heure = h
      ), '[]'::jsonb),

      'statutsLivraison', coalesce((
        select jsonb_agg(jsonb_build_object('nom', nom, 'valeur', n, 'couleur', couleur))
        from (
          select
            case statut_propre
              when 'en_attente'  then 'En attente'
              when 'livre'       then 'Livrée'
              when 'injoignable' then 'Injoignable'
              when 'retour'      then 'Retour'
              else statut_propre
            end as nom,
            case statut_propre
              when 'en_attente'  then '#FFB162'
              when 'livre'       then '#1B2632'
              when 'injoignable' then '#C9C1B1'
              when 'retour'      then '#A35139'
              else '#C9C1B1'
            end as couleur,
            count(*)::int as n
          from liv group by statut_propre
        ) s
      ), '[]'::jsonb),

      -- la répartition des commandes par statut d'appel, avec le NOM réel du
      -- statut tel qu'il est enregistré dans Paramètres
      'overviewAppels', coalesce((
        select jsonb_agg(jsonb_build_object('label', label, 'valeur', n, 'pct', pct) order by n desc)
        from (
          select coalesce(statut_confirmation, 'En file') as label,
                 count(*)::int as n,
                 coalesce(round(100.0 * count(*) / nullif((select count(*) from classe), 0))::int, 0) as pct
          from classe group by 1
        ) s
      ), '[]'::jsonb),

      'topProduits', coalesce((
        select jsonb_agg(jsonb_build_object('rang', rang, 'nom', nom, 'qte', qte) order by rang)
        from (
          select row_number() over (order by sum(coalesce(quantite, 1)) desc)::int as rang,
                 produit as nom,
                 sum(coalesce(quantite, 1))::int as qte
          from classe where produit is not null and btrim(produit) <> ''
          group by produit order by qte desc limit 5
        ) s
      ), '[]'::jsonb),

      'topAgents', coalesce((
        select jsonb_agg(jsonb_build_object('nom', nom, 'livrees', livrees) order by livrees desc)
        from (
          select coalesce(ag.nom, 'Agent non assigné') as nom, pa.livrees
          from par_agent pa
          left join public.agents ag on ag.id = pa.agent_id
          where pa.livrees > 0
          order by pa.livrees desc limit 5
        ) s
      ), '[]'::jsonb),

      'analyticsAgents', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nom', nom, 'appels', appels, 'confirmees', confirmees,
                 'injoignables', injoignables, 'annulees', annulees,
                 'reprogrammees', reprogrammees, 'traitees', traitees,
                 'taux', taux) order by confirmees desc, appels desc)
        from (
          select coalesce(ag.nom, 'Agent non assigné') as nom,
                 coalesce(na.appels, 0) as appels,
                 pa.confirmees, pa.injoignables, pa.annulees, pa.reprogrammees,
                 (pa.confirmees + pa.injoignables + pa.annulees + pa.reprogrammees) as traitees,
                 coalesce(round(100.0 * pa.confirmees / nullif(
                   pa.confirmees + pa.injoignables + pa.annulees + pa.reprogrammees, 0))::int, 0) as taux
          from par_agent pa
          left join public.agents ag on ag.id = pa.agent_id
          left join nb_appels na on na.agent_id is not distinct from pa.agent_id
        ) s
      ), '[]'::jsonb),

      'totauxAgents', (
        select jsonb_build_object(
          'appels',        coalesce((select sum(appels) from nb_appels), 0),
          'confirmees',    coalesce(sum(confirmees), 0),
          'injoignables',  coalesce(sum(injoignables), 0),
          'annulees',      coalesce(sum(annulees), 0),
          'reprogrammees', coalesce(sum(reprogrammees), 0))
        from par_agent
      )
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.statut_cible (
  p_nom text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select case
    when p_nom is null                      then 'Unreached'
    when lower(p_nom) like '%confirm%'      then 'Confirmed'
    when lower(p_nom) like '%annul%'
      or lower(p_nom) like '%cancel%'
      or lower(p_nom) like '%refus%'        then 'Cancelled'
    when lower(p_nom) like '%doubl%'        then 'Double'
    when lower(p_nom) like '%rappel%'
      or lower(p_nom) like '%remind%'       then 'Reminder'
    when lower(p_nom) like '%spam%'         then 'Spam'
    when lower(p_nom) like '%test%'         then 'Test'
    else 'Unreached'
  end
$function$;

CREATE OR REPLACE FUNCTION public.supprimer_pays (
  p_pays uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_tenant   uuid;
  v_nom      text;
  v_bloc     text[] := '{}';
  n          bigint;
  fk         record;
  f          record;
  v_zones    bigint := 0;
  v_statuts  bigint := 0;
  v_entrepot bigint := 0;
  v_fiches   bigint := 0;
  v_cites    text[] := '{}';
begin
  select tenant_id, nom into v_tenant, v_nom from public.pays where id = p_pays;
  if v_tenant is null then
    raise exception 'Pays introuvable';
  end if;

  if auth.uid() is not null
     and not (public.is_super_admin() or (v_tenant = public.get_my_tenant_id() and public.gere_la_config())) then
    raise exception 'Seuls le manager et l''administrateur peuvent supprimer un pays';
  end if;

  -- ---------- Ce qui bloque : du travail réel ----------
  select count(*) into n from public.commandes where pays_id = p_pays;
  if n > 0 then v_bloc := v_bloc || format('%s commande(s)', n); end if;

  if to_regclass('public.expeditions') is not null then
    select count(*) into n from public.expeditions where pays_destination_id = p_pays;
    if n > 0 then v_bloc := v_bloc || format('%s expédition(s)', n); end if;
  end if;

  -- Un entrepôt vide s'en va avec le pays ; un entrepôt qui contient de la
  -- marchandise, non : ce serait perdre un inventaire pour ranger une liste.
  select count(*) into n
  from public.entrepots e
  where e.pays_id = p_pays
    and exists (
      select 1 from public.stocks s
      where s.entrepot_id = e.id
        and (coalesce(s.quantite_disponible, 0) > 0 or coalesce(s.quantite_defectueuse, 0) > 0)
    );
  if n > 0 then v_bloc := v_bloc || format('%s entrepôt(s) avec du stock', n); end if;

  -- En poste = un compte existe encore, ou la fiche est marquée active.
  select count(*) into n from public.agents
   where pays_id = p_pays and (user_id is not null or coalesce(actif, true));
  if n > 0 then v_bloc := v_bloc || format('%s agent(s) en poste', n); end if;

  select count(*) into n from public.livreurs
   where pays_id = p_pays and (user_id is not null or coalesce(actif, true));
  if n > 0 then v_bloc := v_bloc || format('%s livreur(s) en poste', n); end if;

  if array_length(v_bloc, 1) > 0 then
    raise exception '« % » ne peut pas être supprimé : il reste %. Retirez-les d''abord.',
      v_nom, array_to_string(v_bloc, ', ');
  end if;

  -- ---------- Les fiches archivées : partent si personne ne les cite ----------
  for f in
    select 'agents' as t, id, nom from public.agents where pays_id = p_pays
    union all
    select 'livreurs', id, nom from public.livreurs where pays_id = p_pays
  loop
    n := 0;
    for fk in
      select src.relname as tbl, att.attname as col
      from pg_constraint c
      join pg_class src on src.oid = c.conrelid
      join pg_class cib on cib.oid = c.confrelid
      join unnest(c.conkey) as u(attnum) on true
      join pg_attribute att on att.attrelid = c.conrelid and att.attnum = u.attnum
      where c.contype = 'f' and cib.relname = f.t
    loop
      execute format('select count(*) from public.%I where %I = $1', fk.tbl, fk.col)
        into n using f.id;
      exit when n > 0;
    end loop;

    if n > 0 then
      v_cites := v_cites || format('%s (%s)', coalesce(f.nom, f.t), f.t);
    else
      execute format('delete from public.%I where id = $1', f.t) using f.id;
      v_fiches := v_fiches + 1;
    end if;
  end loop;

  if array_length(v_cites, 1) > 0 then
    raise exception '« % » ne peut pas être supprimé : ces fiches archivées sont encore citées dans l''historique — %. Videz d''abord les données qui les mentionnent.',
      v_nom, array_to_string(v_cites, ', ');
  end if;

  -- ---------- Ce qui n'existe que par le pays ----------
  delete from public.stocks s
   using public.entrepots e
   where s.entrepot_id = e.id and e.pays_id = p_pays;

  delete from public.entrepots where pays_id = p_pays;
  get diagnostics v_entrepot = row_count;

  delete from public.zones where pays_id = p_pays;
  get diagnostics v_zones = row_count;

  delete from public.statuts where pays_id = p_pays;
  get diagnostics v_statuts = row_count;

  delete from public.pays where id = p_pays;

  return format(
    '« %s » supprimé — %s zone(s), %s statut(s), %s entrepôt(s) vide(s), %s fiche(s) archivée(s).',
    v_nom, v_zones, v_statuts, v_entrepot, v_fiches
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_nom_vers_user_roles()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.user_id is not null and new.nom is distinct from old.nom then
    update public.user_roles
    set nom = new.nom
    where user_id = new.user_id
      and nom is distinct from new.nom;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.unaccent_simple (
  t text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select translate(
    coalesce(t, ''),
    'àáâãäåèéêëìíîïòóôõöùúûüçñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ',
    'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN'
  )
$function$;

CREATE OR REPLACE FUNCTION public.valider_commande_trigger()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
    -- 1. Le nom du client ne doit pas être vide
    IF NEW.client_nom IS NULL OR trim(NEW.client_nom) = '' THEN
        RAISE EXCEPTION 'Validation métier échouée : Le nom du client est obligatoire.';
    END IF;
    
    -- 2. Le téléphone ne doit pas être vide
    IF NEW.client_telephone IS NULL OR trim(NEW.client_telephone) = '' THEN
        RAISE EXCEPTION 'Validation métier échouée : Le téléphone du client est obligatoire.';
    END IF;

    -- 3. Le produit ne doit pas être vide
    IF NEW.produit IS NULL OR trim(NEW.produit) = '' THEN
        RAISE EXCEPTION 'Validation métier échouée : Le nom du produit est obligatoire.';
    END IF;

    -- 4. Le prix ne peut pas être négatif
    IF NEW.prix IS NULL OR NEW.prix < 0 THEN
        RAISE EXCEPTION 'Validation métier échouée : Le prix ne peut pas être négatif.';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vider_donnees_operationnelles (
  p_tenant uuid
)
  RETURNS TABLE (
    etape  text,
    lignes bigint
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  t      text;
  n      bigint;
  tables text[] := array[
    'reglements_commandes',
    'reglements',
    'paiements',
    'livraisons',
    'appels',
    'imports_bruts',
    'commandes',
    'expeditions_produits',
    'expeditions',
    'mouvements_stock'
  ];
begin
  if p_tenant is null then
    raise exception 'Donnez l''identifiant de l''entreprise';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'Aucune entreprise avec cet identifiant';
  end if;

  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where tenant_id = $1', t) using p_tenant;
      get diagnostics n = row_count;
      etape := t; lignes := n; return next;
    end if;
  end loop;

  update public.stocks
     set quantite_disponible = 0, quantite_defectueuse = 0, quantite_reservee = 0
   where tenant_id = p_tenant;
  get diagnostics n = row_count;
  etape := 'stocks remis a zero'; lignes := n; return next;

  update public.produits
     set current_quantity = 0, quantite_totale = 0, defected_quantity = 0
   where tenant_id = p_tenant;
  get diagnostics n = row_count;
  etape := 'produits remis a zero'; lignes := n; return next;
end;
$function$;

ALTER TABLE "public"."agents"
  ADD CONSTRAINT "agents_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE "public"."appels"
  ADD CONSTRAINT "appels_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES public.agents(id);

ALTER TABLE "public"."commandes"
  ADD CONSTRAINT "commandes_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;

ALTER TABLE "public"."appels"
  ADD CONSTRAINT "appels_commande_id_fkey" FOREIGN KEY (commande_id) REFERENCES public.commandes(id) ON DELETE CASCADE;

ALTER TABLE "public"."commandes"
  ADD CONSTRAINT "commandes_vendeur_id_fkey" FOREIGN KEY (vendeur_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."commandes"
  ADD CONSTRAINT "commandes_entrepot_id_fkey" FOREIGN KEY (entrepot_id) REFERENCES public.entrepots(id) ON DELETE SET NULL;

ALTER TABLE "public"."expeditions"
  ADD CONSTRAINT "expeditions_confirme_par_fkey" FOREIGN KEY (confirme_par) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."expeditions"
  ADD CONSTRAINT "expeditions_entrepot_destination_id_fkey" FOREIGN KEY (entrepot_destination_id) REFERENCES public.entrepots(id) ON DELETE SET NULL;

ALTER TABLE "public"."expeditions"
  ADD CONSTRAINT "expeditions_entrepot_reception_id_fkey" FOREIGN KEY (entrepot_reception_id) REFERENCES public.entrepots(id) ON DELETE SET NULL;

ALTER TABLE "public"."expeditions"
  ADD CONSTRAINT "expeditions_recu_par_fkey" FOREIGN KEY (recu_par) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."expeditions"
  ADD CONSTRAINT "expeditions_vendeur_id_fkey" FOREIGN KEY (vendeur_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."expeditions_produits"
  ADD CONSTRAINT "expeditions_produits_expedition_id_fkey" FOREIGN KEY (expedition_id) REFERENCES public.expeditions(id) ON DELETE CASCADE;

ALTER TABLE "public"."imports_bruts"
  ADD CONSTRAINT "imports_bruts_commande_id_fkey" FOREIGN KEY (commande_id) REFERENCES public.commandes(id) ON DELETE SET NULL;

ALTER TABLE "public"."livraisons"
  ADD CONSTRAINT "livraisons_commande_id_fkey" FOREIGN KEY (commande_id) REFERENCES public.commandes(id) ON DELETE CASCADE;

ALTER TABLE "public"."livraisons"
  ADD CONSTRAINT "livraisons_livreur_id_fkey" FOREIGN KEY (livreur_id) REFERENCES public.livreurs(id);

ALTER TABLE "public"."livreurs"
  ADD CONSTRAINT "livreurs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE "public"."livraisons"
  ADD CONSTRAINT "livraisons_motif_retour_id_fkey" FOREIGN KEY (motif_retour_id) REFERENCES public.motifs_retour(id);

ALTER TABLE "public"."mouvements_stock"
  ADD CONSTRAINT "mouvements_stock_entrepot_id_fkey" FOREIGN KEY (entrepot_id) REFERENCES public.entrepots(id) ON DELETE CASCADE;

ALTER TABLE "public"."paiements"
  ADD CONSTRAINT "paiements_commande_id_fkey" FOREIGN KEY (commande_id) REFERENCES public.commandes(id) ON DELETE CASCADE;

ALTER TABLE "public"."paiements"
  ADD CONSTRAINT "paiements_livreur_id_fkey" FOREIGN KEY (livreur_id) REFERENCES public.livreurs(id);

ALTER TABLE "public"."agents"
  ADD CONSTRAINT "agents_pays_id_fkey" FOREIGN KEY (pays_id) REFERENCES public.pays(id);

ALTER TABLE "public"."commandes"
  ADD CONSTRAINT "commandes_pays_id_fkey" FOREIGN KEY (pays_id) REFERENCES public.pays(id);

ALTER TABLE "public"."entrepots"
  ADD CONSTRAINT "entrepots_pays_id_fkey" FOREIGN KEY (pays_id) REFERENCES public.pays(id) ON DELETE SET NULL;

ALTER TABLE "public"."expeditions"
  ADD CONSTRAINT "expeditions_pays_destination_id_fkey" FOREIGN KEY (pays_destination_id) REFERENCES public.pays(id) ON DELETE SET NULL;

ALTER TABLE "public"."livreurs"
  ADD CONSTRAINT "livreurs_pays_id_fkey" FOREIGN KEY (pays_id) REFERENCES public.pays(id);

ALTER TABLE "public"."expeditions_produits"
  ADD CONSTRAINT "expeditions_produits_produit_id_fkey" FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE RESTRICT;

ALTER TABLE "public"."mouvements_stock"
  ADD CONSTRAINT "mouvements_stock_produit_id_fkey" FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE CASCADE;

ALTER TABLE "public"."produits"
  ADD CONSTRAINT "produits_crosssell_produit_id_fkey" FOREIGN KEY (crosssell_produit_id) REFERENCES public.produits(id) ON DELETE SET NULL;

ALTER TABLE "public"."produits"
  ADD CONSTRAINT "produits_upsell_produit_id_fkey" FOREIGN KEY (upsell_produit_id) REFERENCES public.produits(id) ON DELETE SET NULL;

ALTER TABLE "public"."reglements"
  ADD CONSTRAINT "reglements_cree_par_fkey" FOREIGN KEY (cree_par) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."reglements"
  ADD CONSTRAINT "reglements_vendeur_id_fkey" FOREIGN KEY (vendeur_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."reglements_commandes"
  ADD CONSTRAINT "reglements_commandes_commande_id_fkey" FOREIGN KEY (commande_id) REFERENCES public.commandes(id) ON DELETE CASCADE;

ALTER TABLE "public"."reglements_commandes"
  ADD CONSTRAINT "reglements_commandes_reglement_id_fkey" FOREIGN KEY (reglement_id) REFERENCES public.reglements(id) ON DELETE CASCADE;

ALTER TABLE "public"."role_permissions"
  ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY (permission_code) REFERENCES public.permissions(code) ON DELETE CASCADE;

ALTER TABLE "public"."role_permissions"
  ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

ALTER TABLE "public"."sources_import"
  ADD CONSTRAINT "sources_import_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."commandes"
  ADD CONSTRAINT "commandes_source_id_fkey" FOREIGN KEY (source_id) REFERENCES public.sources_import(id) ON DELETE SET NULL;

ALTER TABLE "public"."imports_bruts"
  ADD CONSTRAINT "imports_bruts_source_id_fkey" FOREIGN KEY (source_id) REFERENCES public.sources_import(id) ON DELETE SET NULL;

ALTER TABLE "public"."sources_import"
  ADD CONSTRAINT "sources_import_vendeur_id_fkey" FOREIGN KEY (vendeur_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."statuts"
  ADD CONSTRAINT "statuts_pays_id_fkey" FOREIGN KEY (pays_id) REFERENCES public.pays(id) ON DELETE CASCADE;

ALTER TABLE "public"."stocks"
  ADD CONSTRAINT "stocks_entrepot_id_fkey" FOREIGN KEY (entrepot_id) REFERENCES public.entrepots(id) ON DELETE CASCADE;

ALTER TABLE "public"."stocks"
  ADD CONSTRAINT "stocks_produit_id_fkey" FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE CASCADE;

ALTER TABLE "public"."agents"
  ADD CONSTRAINT "agents_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE "public"."commandes"
  ADD CONSTRAINT "commandes_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE "public"."imports_bruts"
  ADD CONSTRAINT "imports_bruts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."roles"
  ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."sources_import"
  ADD CONSTRAINT "sources_import_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_roles"
  ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;

ALTER TABLE "public"."user_roles"
  ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE "public"."user_roles"
  ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE "public"."zones"
  ADD CONSTRAINT "zones_pays_id_fkey" FOREIGN KEY (pays_id) REFERENCES public.pays(id);

ALTER TABLE "public"."commandes"
  ADD CONSTRAINT "commandes_zone_id_fkey" FOREIGN KEY (zone_id) REFERENCES public.zones(id);

CREATE VIEW "public"."v_caisses_livreur" WITH (security_invoker=on) AS  SELECT p.tenant_id,
    l.id AS livreur_id,
    COALESCE(l.nom, 'Inconnu'::text) AS livreur_nom,
    COALESCE(pa.devise, 'N/A'::text) AS devise,
    sum(p.montant) AS total,
    (count(*))::integer AS nb_paiements
   FROM (((public.paiements p
     LEFT JOIN public.livreurs l ON ((l.id = p.livreur_id)))
     LEFT JOIN public.commandes c ON ((c.id = p.commande_id)))
     LEFT JOIN public.pays pa ON ((pa.id = c.pays_id)))
  WHERE (p.statut = 'encaisse'::text)
  GROUP BY p.tenant_id, l.id, COALESCE(l.nom, 'Inconnu'::text), COALESCE(pa.devise, 'N/A'::text);

CREATE VIEW "public"."v_commandes_a_assigner" WITH (security_invoker=on) AS  SELECT id,
    lead_id,
    source,
    client_nom,
    client_telephone,
    produit,
    pays_id,
    zone_id,
    statut_confirmation,
    statut_livraison,
    statut_paiement,
    is_doublon,
    created_at,
    updated_at,
    date_commande,
    ville_zone,
    source_url,
    commentaire_1,
    whatsapp_tracking,
    source_sheet,
    whatsapp_followup,
    notes,
    commentaire_2,
    quantite,
    date_rappel,
    prix,
    tenant_id,
    agent_id
   FROM public.commandes c
  WHERE ((EXISTS ( SELECT 1
           FROM public.statuts s
          WHERE ((s.tenant_id = c.tenant_id) AND ((s.nom = c.statut_confirmation) OR (s.code = c.statut_confirmation)) AND ((s.pays_id IS NULL) OR (s.pays_id = c.pays_id)) AND (s.declenche_assignation = true)))) AND (NOT (EXISTS ( SELECT 1
           FROM public.livraisons v
          WHERE (v.commande_id = c.id)))));

CREATE VIEW "public"."v_commandes_a_regler" WITH (security_invoker=on) AS  SELECT c.id AS commande_id,
    c.tenant_id,
    c.vendeur_id,
    c.lead_id,
    c.client_nom,
    c.produit,
    COALESCE(c.quantite, 1) AS quantite,
    COALESCE(c.prix, (0)::numeric) AS prix,
    c.statut_livraison,
    c.updated_at,
    c.created_at,
    p.devise
   FROM (public.commandes c
     LEFT JOIN public.pays p ON ((p.id = c.pays_id)))
  WHERE ((c.statut_livraison = 'livre'::text) AND (c.vendeur_id IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.reglements_commandes rc
          WHERE (rc.commande_id = c.id)))));

CREATE VIEW "public"."v_options_filtres" WITH (security_invoker=on) AS  SELECT DISTINCT commandes.tenant_id,
    'produit'::text AS champ,
    btrim(commandes.produit) AS valeur
   FROM public.commandes
  WHERE ((commandes.produit IS NOT NULL) AND (btrim(commandes.produit) <> ''::text))
UNION
 SELECT DISTINCT commandes.tenant_id,
    'ville'::text AS champ,
    btrim(commandes.ville_zone) AS valeur
   FROM public.commandes
  WHERE ((commandes.ville_zone IS NOT NULL) AND (btrim(commandes.ville_zone) <> ''::text))
UNION
 SELECT DISTINCT commandes.tenant_id,
    'source'::text AS champ,
    btrim(commandes.source) AS valeur
   FROM public.commandes
  WHERE ((commandes.source IS NOT NULL) AND (btrim(commandes.source) <> ''::text));

CREATE VIEW "public"."v_pays_livrables" AS  SELECT DISTINCT p.tenant_id,
    p.id AS pays_id,
    p.nom,
    p.code,
    p.devise
   FROM (public.entrepots e
     JOIN public.pays p ON ((p.id = e.pays_id)))
  WHERE ((e.pays_id IS NOT NULL) AND (public.is_super_admin() OR (p.tenant_id = public.get_my_tenant_id())));

CREATE INDEX idx_agents_tenant_id ON public.agents USING btree (tenant_id);

CREATE INDEX idx_appels_commande ON public.appels USING btree (commande_id, created_at DESC);

CREATE INDEX idx_appels_tenant_date ON public.appels USING btree (tenant_id, created_at);

CREATE INDEX idx_appels_tenant_id ON public.appels USING btree (tenant_id);

CREATE INDEX idx_commandes_entrepot ON public.commandes USING btree (tenant_id, entrepot_id)
  WHERE (entrepot_id IS NOT NULL);

CREATE INDEX idx_commandes_lead_id ON public.commandes USING btree (lead_id);

CREATE INDEX idx_commandes_pool ON public.commandes USING btree (tenant_id, agent_id, statut_confirmation);

CREATE INDEX idx_commandes_produit ON public.commandes USING btree (tenant_id, produit);

CREATE INDEX idx_commandes_source ON public.commandes USING btree (tenant_id, source);

CREATE INDEX idx_commandes_telephone ON public.commandes USING btree (client_telephone);

CREATE INDEX idx_commandes_tenant_date ON public.commandes USING btree (tenant_id, created_at);

CREATE INDEX idx_commandes_tenant_id ON public.commandes USING btree (tenant_id);

CREATE INDEX idx_commandes_tracking ON public.commandes USING btree (tenant_id, tracking_number)
  WHERE (tracking_number IS NOT NULL);

CREATE INDEX idx_commandes_vendeur ON public.commandes USING btree (tenant_id, vendeur_id);

CREATE INDEX idx_commandes_ville ON public.commandes USING btree (tenant_id, ville_zone);

CREATE INDEX idx_exp_produits_expedition ON public.expeditions_produits USING btree (expedition_id);

CREATE INDEX idx_expeditions_date ON public.expeditions USING btree (tenant_id, date_expedition DESC);

CREATE INDEX idx_expeditions_entrepot ON public.expeditions USING btree (entrepot_destination_id);

CREATE INDEX idx_expeditions_tenant ON public.expeditions USING btree (tenant_id, statut);

CREATE INDEX idx_expeditions_vendeur ON public.expeditions USING btree (vendeur_id);

CREATE INDEX idx_imports_bruts_cle ON public.imports_bruts USING btree (tenant_id, cle_externe)
  WHERE (cle_externe IS NOT NULL);

CREATE INDEX idx_imports_bruts_rejetes ON public.imports_bruts USING btree (tenant_id, created_at DESC)
  WHERE (statut = 'rejete'::text);

CREATE INDEX idx_imports_bruts_source ON public.imports_bruts USING btree (source_id, created_at DESC);

CREATE INDEX idx_imports_bruts_tenant ON public.imports_bruts USING btree (tenant_id, created_at DESC);

CREATE INDEX idx_livraisons_commande ON public.livraisons USING btree (commande_id);

CREATE INDEX idx_livraisons_livreur ON public.livraisons USING btree (livreur_id, statut);

CREATE INDEX idx_livraisons_tenant_date ON public.livraisons USING btree (tenant_id, created_at);

CREATE INDEX idx_livraisons_tenant_id ON public.livraisons USING btree (tenant_id);

CREATE INDEX idx_livreurs_tenant_id ON public.livreurs USING btree (tenant_id);

CREATE INDEX idx_paiements_tenant_date ON public.paiements USING btree (tenant_id, created_at);

CREATE INDEX idx_paiements_tenant_id ON public.paiements USING btree (tenant_id);

CREATE UNIQUE INDEX idx_pays_nom_unique ON public.pays USING btree (tenant_id, lower(btrim(nom)));

CREATE INDEX idx_pays_tenant_id ON public.pays USING btree (tenant_id);

CREATE INDEX idx_produits_product ON public.produits USING btree (tenant_id, lower(product));

CREATE INDEX idx_produits_tenant_id ON public.produits USING btree (tenant_id);

CREATE INDEX idx_produits_tenant_statut ON public.produits USING btree (tenant_id, statut);

CREATE INDEX idx_reglements_commandes_reglement ON public.reglements_commandes USING btree (reglement_id);

CREATE INDEX idx_reglements_tenant ON public.reglements USING btree (tenant_id, statut);

CREATE INDEX idx_reglements_vendeur ON public.reglements USING btree (vendeur_id);

CREATE INDEX idx_sources_import_sheets ON public.sources_import USING btree (actif, derniere_sync)
  WHERE (TYPE = 'google_sheet'::text);

CREATE INDEX idx_sources_import_tenant ON public.sources_import USING btree (tenant_id, actif);

CREATE UNIQUE INDEX idx_stocks_produit_entrepot ON public.stocks USING btree (produit_id, entrepot_id);

CREATE INDEX idx_user_roles_tenant_id ON public.user_roles USING btree (tenant_id);

CREATE INDEX idx_zones_tenant_id ON public.zones USING btree (tenant_id);

CREATE UNIQUE INDEX statuts_tenant_pays_code_unique ON public.statuts USING btree (tenant_id, pays_id, code);

CREATE TRIGGER tr_check_agent_pays
  BEFORE INSERT OR UPDATE ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.check_agent_pays();

CREATE TRIGGER tr_check_fiche_agents
  BEFORE INSERT OR UPDATE OF user_id, tenant_id ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.check_fiche_tenant();

CREATE TRIGGER tr_protege_fiche_agent
  BEFORE UPDATE ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.protege_fiche_agent();

CREATE TRIGGER tr_set_tenant_id_agents
  BEFORE INSERT ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER tr_sync_nom_agents
  AFTER UPDATE OF nom ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_nom_vers_user_roles();

CREATE TRIGGER trg_set_tenant_id_agents
  BEFORE INSERT ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE TRIGGER trg_set_tenant_id_appels
  BEFORE INSERT ON public.appels
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE TRIGGER tr_auto_affecter_agent
  BEFORE INSERT ON public.commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_affecter_agent();

CREATE TRIGGER tr_auto_affecter_livreur
  AFTER INSERT OR UPDATE OF statut_confirmation ON public.commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_affecter_livreur();

CREATE TRIGGER tr_set_tenant_id_commandes
  BEFORE INSERT ON public.commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER tr_tracking_commande
  BEFORE INSERT ON public.commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.attribuer_tracking();

CREATE TRIGGER trg_set_tenant_id_commandes
  BEFORE INSERT ON public.commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE TRIGGER trg_valider_commande
  BEFORE INSERT OR UPDATE ON public.commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.valider_commande_trigger();

CREATE TRIGGER trigger_assignation_auto
  BEFORE INSERT ON public.commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.assigner_lead_automatiquement();

CREATE TRIGGER tr_expedition_reception_figee
  BEFORE UPDATE ON public.expeditions
  FOR EACH ROW
  EXECUTE FUNCTION public.expedition_reception_figee();

CREATE TRIGGER tr_expeditions_garde
  BEFORE INSERT OR UPDATE ON public.expeditions
  FOR EACH ROW
  EXECUTE FUNCTION public.expeditions_garde();

CREATE TRIGGER tr_expeditions_reference
  BEFORE INSERT ON public.expeditions
  FOR EACH ROW
  EXECUTE FUNCTION public.expeditions_reference();

CREATE TRIGGER tr_check_livraison
  BEFORE INSERT OR UPDATE OF livreur_id, commande_id, tenant_id ON public.livraisons
  FOR EACH ROW
  EXECUTE FUNCTION public.check_livraison_coherente();

CREATE TRIGGER trg_ajuster_stock_livraison_insert
  AFTER INSERT ON public.livraisons
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ajuster_stock_livraison();

CREATE TRIGGER trg_ajuster_stock_livraison_update
  AFTER UPDATE ON public.livraisons
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ajuster_stock_livraison();

CREATE TRIGGER trg_set_tenant_id_livraisons
  BEFORE INSERT ON public.livraisons
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE TRIGGER tr_check_fiche_livreurs
  BEFORE INSERT OR UPDATE OF user_id, tenant_id ON public.livreurs
  FOR EACH ROW
  EXECUTE FUNCTION public.check_fiche_tenant();

CREATE TRIGGER tr_check_livreur_pays
  BEFORE INSERT OR UPDATE ON public.livreurs
  FOR EACH ROW
  EXECUTE FUNCTION public.check_livreur_pays();

CREATE TRIGGER tr_protege_fiche_livreur
  BEFORE UPDATE ON public.livreurs
  FOR EACH ROW
  EXECUTE FUNCTION public.protege_fiche_livreur();

CREATE TRIGGER tr_sync_nom_livreurs
  AFTER UPDATE OF nom ON public.livreurs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_nom_vers_user_roles();

CREATE TRIGGER trg_set_tenant_id_livreurs
  BEFORE INSERT ON public.livreurs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE TRIGGER trg_actualiser_stock
  AFTER INSERT ON public.mouvements_stock
  FOR EACH ROW
  EXECUTE FUNCTION public.actualiser_stock_apres_mouvement();

CREATE TRIGGER trg_set_tenant_id_paiements
  BEFORE INSERT ON public.paiements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE TRIGGER trg_set_tenant_id_pays
  BEFORE INSERT ON public.pays
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE TRIGGER trg_set_tenant_id_produits
  BEFORE INSERT ON public.produits
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE TRIGGER tr_reglements_garde
  BEFORE INSERT OR UPDATE ON public.reglements
  FOR EACH ROW
  EXECUTE FUNCTION public.reglements_garde();

CREATE TRIGGER tr_reglements_reference
  BEFORE INSERT ON public.reglements
  FOR EACH ROW
  EXECUTE FUNCTION public.reglements_reference();

CREATE TRIGGER tr_reglements_lignes_garde
  BEFORE INSERT OR DELETE OR UPDATE ON public.reglements_commandes
  FOR EACH ROW
  EXECUTE FUNCTION public.reglements_lignes_garde();

CREATE TRIGGER trg_set_tenant_id_user_roles
  BEFORE INSERT ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE TRIGGER trg_set_tenant_id_zones
  BEFORE INSERT ON public.zones
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_auto();

CREATE POLICY "agents_update" ON "public"."agents"
  FOR UPDATE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (user_id = auth.uid())))))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (user_id = auth.uid())))));

CREATE POLICY "lecture_agents" ON "public"."agents"
  FOR SELECT
  TO "authenticated"
  USING (((tenant_id = public.get_my_tenant_id()) OR public.is_super_admin()));

CREATE POLICY "appels_delete" ON "public"."appels"
  FOR DELETE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.est_responsable())));

CREATE POLICY "appels_insert" ON "public"."appels"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (public.mon_role() = 'agent'::text)))));

CREATE POLICY "appels_select" ON "public"."appels"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (agent_id = public.mon_agent_id()) OR (agent_id IS NULL)))));

CREATE POLICY "appels_update" ON "public"."appels"
  FOR UPDATE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (agent_id = public.mon_agent_id()) OR (agent_id IS NULL)))))
  WITH CHECK ((public.is_super_admin() OR (tenant_id = public.get_my_tenant_id())));

CREATE POLICY "commandes_delete" ON "public"."commandes"
  FOR DELETE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.mon_role() = ANY (ARRAY['admin'::text, 'ceo'::text, 'manager'::text])))));

CREATE POLICY "commandes_insert" ON "public"."commandes"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.mon_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'seller'::text, 'agent'::text])) AND
    ((public.mon_role() <> 'seller'::text) OR (vendeur_id = auth.uid())))));

CREATE POLICY "commandes_select" ON "public"."commandes"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND
CASE public.mon_role()
    WHEN 'admin'::text THEN true
    WHEN 'ceo'::text THEN true
    WHEN 'manager'::text THEN true
    WHEN 'agent'::text THEN ((agent_id IN ( SELECT agents.id
       FROM public.agents
      WHERE (agents.user_id = auth.uid()))) OR (agent_id IS NULL))
    WHEN 'seller'::text THEN (vendeur_id = auth.uid())
    WHEN 'livreur'::text THEN public.est_ma_livraison(id)
    ELSE false
END)));

CREATE POLICY "commandes_update" ON "public"."commandes"
  FOR UPDATE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND
CASE public.mon_role()
    WHEN 'admin'::text THEN true
    WHEN 'ceo'::text THEN true
    WHEN 'manager'::text THEN true
    WHEN 'agent'::text THEN ((agent_id IN ( SELECT agents.id
       FROM public.agents
      WHERE (agents.user_id = auth.uid()))) OR (agent_id IS NULL))
    WHEN 'seller'::text THEN (vendeur_id = auth.uid())
    ELSE false
END)))
  WITH CHECK ((public.is_super_admin() OR (tenant_id = public.get_my_tenant_id())));

CREATE POLICY "entrepots_ecriture" ON "public"."entrepots"
  FOR ALL
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())));

CREATE POLICY "entrepots_select" ON "public"."entrepots"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.est_responsable())));

CREATE POLICY "expeditions_delete" ON "public"."expeditions"
  FOR DELETE
  TO "authenticated"
  USING
    ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND ((lower(COALESCE(public.mon_role(), ''::text)) = ANY (ARRAY['admin'::text, 'manager'::text])) OR
    ((lower(COALESCE(public.mon_role(), ''::text)) = 'seller'::text) AND (vendeur_id = auth.uid()) AND (statut = 'en_attente'::text))))));

CREATE POLICY "expeditions_insert" ON "public"."expeditions"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (lower(COALESCE(public.mon_role(), ''::text)) = ANY (ARRAY['admin'::text, 'manager'::text,
    'seller'::text])))));

CREATE POLICY "expeditions_select" ON "public"."expeditions"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (vendeur_id = auth.uid())))));

CREATE POLICY "expeditions_update" ON "public"."expeditions"
  FOR UPDATE
  TO "authenticated"
  USING
    ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND ((lower(COALESCE(public.mon_role(), ''::text)) = ANY (ARRAY['admin'::text, 'manager'::text])) OR
    ((lower(COALESCE(public.mon_role(), ''::text)) = 'seller'::text) AND (vendeur_id = auth.uid()))))))
  WITH
    CHECK
    ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND ((lower(COALESCE(public.mon_role(), ''::text)) = ANY (ARRAY['admin'::text, 'manager'::text])) OR
    ((lower(COALESCE(public.mon_role(), ''::text)) = 'seller'::text) AND (vendeur_id = auth.uid()))))));

CREATE POLICY "exp_produits_delete" ON "public"."expeditions_produits"
  FOR DELETE
  TO "authenticated"
  USING (public.expedition_modifiable(expedition_id));

CREATE POLICY "exp_produits_insert" ON "public"."expeditions_produits"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((tenant_id = public.get_my_tenant_id()) AND public.expedition_modifiable(expedition_id)));

CREATE POLICY "exp_produits_select" ON "public"."expeditions_produits"
  FOR SELECT
  TO "authenticated"
  USING (public.expedition_visible(expedition_id));

CREATE POLICY "exp_produits_update" ON "public"."expeditions_produits"
  FOR UPDATE
  TO "authenticated"
  USING (public.expedition_modifiable(expedition_id))
  WITH CHECK (public.expedition_modifiable(expedition_id));

CREATE POLICY "imports_select" ON "public"."imports_bruts"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR public.source_m_appartient(source_id)))));

CREATE POLICY "livraisons_delete" ON "public"."livraisons"
  FOR DELETE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.est_responsable())));

CREATE POLICY "livraisons_insert" ON "public"."livraisons"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.est_responsable())));

CREATE POLICY "livraisons_select" ON "public"."livraisons"
  FOR SELECT
  TO "authenticated"
  USING
    ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (livreur_id = public.mon_livreur_id()) OR ((public.mon_role() =
    'seller'::text) AND public.commande_de_mon_seller(commande_id)) OR ((public.mon_role() = 'agent'::text) AND public.commande_de_mon_agent(commande_id))))));

CREATE POLICY "livraisons_update" ON "public"."livraisons"
  FOR UPDATE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (livreur_id = public.mon_livreur_id())))))
  WITH CHECK ((public.is_super_admin() OR (tenant_id = public.get_my_tenant_id())));

CREATE POLICY "lecture_livreurs" ON "public"."livreurs"
  FOR SELECT
  TO "authenticated"
  USING (((tenant_id = public.get_my_tenant_id()) OR public.is_super_admin()));

CREATE POLICY "livreurs_update" ON "public"."livreurs"
  FOR UPDATE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (user_id = auth.uid())))))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (user_id = auth.uid())))));

CREATE POLICY "utilisateurs_connectes_lisent_motifs_retour" ON "public"."motifs_retour"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "mouvements_ecriture" ON "public"."mouvements_stock"
  FOR ALL
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())));

CREATE POLICY "mouvements_select" ON "public"."mouvements_stock"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.est_responsable())));

CREATE POLICY "paiements_delete" ON "public"."paiements"
  FOR DELETE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.est_responsable())));

CREATE POLICY "paiements_insert" ON "public"."paiements"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (livreur_id = public.mon_livreur_id())))));

CREATE POLICY "paiements_select" ON "public"."paiements"
  FOR SELECT
  TO "authenticated"
  USING
    ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (livreur_id = public.mon_livreur_id()) OR ((public.mon_role() =
    'seller'::text) AND public.commande_de_mon_seller(commande_id))))));

CREATE POLICY "paiements_update" ON "public"."paiements"
  FOR UPDATE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (livreur_id = public.mon_livreur_id())))))
  WITH CHECK ((public.is_super_admin() OR (tenant_id = public.get_my_tenant_id())));

CREATE POLICY "pays_ecriture" ON "public"."pays"
  FOR ALL
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())));

CREATE POLICY "pays_select" ON "public"."pays"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_super_admin() OR (tenant_id = public.get_my_tenant_id())));

CREATE POLICY "lecture_permissions_utilisateurs_connectes" ON "public"."permissions"
  FOR SELECT
  TO "authenticated"
  USING ((auth.uid() IS NOT NULL));

CREATE POLICY "produits_delete" ON "public"."produits"
  FOR DELETE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (lower(public.mon_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'seller'::text])))));

CREATE POLICY "produits_insert" ON "public"."produits"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (lower(public.mon_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'seller'::text])))));

CREATE POLICY "produits_select" ON "public"."produits"
  FOR SELECT
  TO "authenticated"
  USING (((tenant_id = public.get_my_tenant_id()) OR public.is_super_admin()));

CREATE POLICY "produits_update" ON "public"."produits"
  FOR UPDATE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (lower(public.mon_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'seller'::text])))))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (lower(public.mon_role()) = ANY (ARRAY['admin'::text, 'manager'::text, 'seller'::text])))));

CREATE POLICY "reglements_delete" ON "public"."reglements"
  FOR DELETE
  TO "authenticated"
  USING
    ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (lower(COALESCE(public.mon_role(), ''::text)) = ANY (ARRAY['admin'::text, 'manager'::text])) AND
    (statut <> 'paye'::text))));

CREATE POLICY "reglements_insert" ON "public"."reglements"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (lower(COALESCE(public.mon_role(), ''::text)) = ANY (ARRAY['admin'::text, 'manager'::text])))));

CREATE POLICY "reglements_select" ON "public"."reglements"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (vendeur_id = auth.uid())))));

CREATE POLICY "reglements_update" ON "public"."reglements"
  FOR UPDATE
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (lower(COALESCE(public.mon_role(), ''::text)) = ANY (ARRAY['admin'::text, 'manager'::text])))))
  WITH
    CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (lower(COALESCE(public.mon_role(), ''::text)) = ANY (ARRAY['admin'::text, 'manager'::text])))));

CREATE POLICY "reglements_commandes_delete" ON "public"."reglements_commandes"
  FOR DELETE
  TO "authenticated"
  USING (public.reglement_modifiable(reglement_id));

CREATE POLICY "reglements_commandes_insert" ON "public"."reglements_commandes"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((tenant_id = public.get_my_tenant_id()) AND public.reglement_modifiable(reglement_id)));

CREATE POLICY "reglements_commandes_select" ON "public"."reglements_commandes"
  FOR SELECT
  TO "authenticated"
  USING (public.reglement_visible(reglement_id));

CREATE POLICY "ecriture_role_permissions_super_admin" ON "public"."role_permissions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_super_admin());

CREATE POLICY "lecture_role_permissions_utilisateurs_connectes" ON "public"."role_permissions"
  FOR SELECT
  TO "authenticated"
  USING ((auth.uid() IS NOT NULL));

CREATE POLICY "modification_role_permissions_super_admin" ON "public"."role_permissions"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "suppression_role_permissions_super_admin" ON "public"."role_permissions"
  FOR DELETE
  TO "authenticated"
  USING (public.is_super_admin());

CREATE POLICY "lecture_roles_utilisateurs_connectes" ON "public"."roles"
  FOR SELECT
  TO "authenticated"
  USING ((auth.uid() IS NOT NULL));

CREATE POLICY "modification_roles_super_admin_seulement" ON "public"."roles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_super_admin());

CREATE POLICY "suppression_roles_super_admin_seulement" ON "public"."roles"
  FOR DELETE
  TO "authenticated"
  USING (public.is_super_admin());

CREATE POLICY "sources_delete" ON "public"."sources_import"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (vendeur_id = auth.uid())))));

CREATE POLICY "sources_insert" ON "public"."sources_import"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (vendeur_id = auth.uid())))));

CREATE POLICY "sources_select" ON "public"."sources_import"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (vendeur_id = auth.uid())))));

CREATE POLICY "sources_update" ON "public"."sources_import"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (vendeur_id = auth.uid())))))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (vendeur_id = auth.uid())))));

CREATE POLICY "statuts_ecriture" ON "public"."statuts"
  FOR ALL
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())));

CREATE POLICY "statuts_select" ON "public"."statuts"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_super_admin() OR (tenant_id IS NULL) OR (tenant_id = public.get_my_tenant_id())));

CREATE POLICY "stocks_ecriture" ON "public"."stocks"
  FOR ALL
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())));

CREATE POLICY "stocks_select" ON "public"."stocks"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.est_responsable())));

CREATE POLICY "tenant_delete_super_admin" ON "public"."tenants"
  FOR DELETE
  TO "authenticated"
  USING (public.is_super_admin());

CREATE POLICY "tenant_insert_super_admin" ON "public"."tenants"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_super_admin());

CREATE POLICY "tenant_select_own" ON "public"."tenants"
  FOR SELECT
  TO "authenticated"
  USING (((id = public.get_my_tenant_id()) OR public.is_super_admin()));

CREATE POLICY "tenant_update_super_admin" ON "public"."tenants"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "insertion_user_roles" ON "public"."user_roles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_super_admin());

CREATE POLICY "modification_user_roles" ON "public"."user_roles"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "suppression_user_roles" ON "public"."user_roles"
  FOR DELETE
  TO "authenticated"
  USING (public.is_super_admin());

CREATE POLICY "user_roles_select" ON "public"."user_roles"
  FOR SELECT
  TO "authenticated"
  USING (((user_id = auth.uid()) OR public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.est_responsable())));

CREATE POLICY "zones_ecriture" ON "public"."zones"
  FOR ALL
  TO "authenticated"
  USING ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())))
  WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND public.gere_la_config())));

CREATE POLICY "zones_select" ON "public"."zones"
  FOR SELECT
  TO "authenticated"
  USING
    ((public.is_super_admin() OR ((tenant_id = public.get_my_tenant_id()) AND (public.est_responsable() OR (lower(COALESCE(public.mon_role(), ''::text)) = ANY (ARRAY['agent'::text,
    'livreur'::text]))))));

CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();

GRANT EXECUTE ON FUNCTION "public"."actualiser_stock_apres_mouvement"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."actualiser_stock_apres_mouvement"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."actualiser_stock_apres_mouvement"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."actualiser_stock_apres_mouvement"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."assigner_lead_automatiquement"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."assigner_lead_automatiquement"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."assigner_lead_automatiquement"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."assigner_lead_automatiquement"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."attribuer_tracking"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."attribuer_tracking"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."attribuer_tracking"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."attribuer_tracking"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."auto_affecter_agent"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."auto_affecter_agent"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."auto_affecter_agent"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."auto_affecter_agent"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."auto_affecter_livreur"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."auto_affecter_livreur"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."auto_affecter_livreur"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."auto_affecter_livreur"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."check_agent_pays"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."check_agent_pays"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_agent_pays"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_agent_pays"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."check_fiche_tenant"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."check_fiche_tenant"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_fiche_tenant"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_fiche_tenant"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."check_livraison_coherente"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."check_livraison_coherente"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_livraison_coherente"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_livraison_coherente"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."check_livreur_pays"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."check_livreur_pays"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_livreur_pays"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_livreur_pays"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."choisir_agent"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."choisir_agent"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."choisir_agent"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."choisir_livreur"(uuid, uuid, text, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."choisir_livreur"(uuid, uuid, text, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."choisir_livreur"(uuid, uuid, text, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."commande_de_mon_agent"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."commande_de_mon_agent"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."commande_de_mon_agent"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."commande_de_mon_agent"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."commande_de_mon_seller"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."commande_de_mon_seller"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."commande_de_mon_seller"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."commande_de_mon_seller"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."debug_auth_uid"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."debug_auth_uid"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."debug_auth_uid"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."debug_auth_uid"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."debug_check_definer"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."debug_check_definer"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."debug_check_definer"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."debug_check_definer"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."debug_check_invoker"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."debug_check_invoker"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."debug_check_invoker"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."debug_check_invoker"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."est_ma_livraison"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."est_ma_livraison"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."est_ma_livraison"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."est_ma_livraison"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."est_responsable"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."est_responsable"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."est_responsable"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."est_responsable"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."expedition_modifiable"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."expedition_modifiable"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expedition_modifiable"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expedition_modifiable"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."expedition_reception_figee"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."expedition_reception_figee"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expedition_reception_figee"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expedition_reception_figee"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."expedition_visible"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."expedition_visible"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expedition_visible"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expedition_visible"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."expeditions_garde"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."expeditions_garde"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expeditions_garde"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expeditions_garde"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."expeditions_reference"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."expeditions_reference"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expeditions_reference"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expeditions_reference"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."fn_ajuster_stock_livraison"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."fn_ajuster_stock_livraison"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_ajuster_stock_livraison"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_ajuster_stock_livraison"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."gere_la_config"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."gere_la_config"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."gere_la_config"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."gere_la_config"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_mes_permissions"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_mes_permissions"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_mes_permissions"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_mes_permissions"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_my_tenant_id"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_my_tenant_id"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_my_tenant_id"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_my_tenant_id"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."mon_agent_id"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."mon_agent_id"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mon_agent_id"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."mon_agent_id"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."mon_livreur_id"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."mon_livreur_id"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mon_livreur_id"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."mon_livreur_id"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."mon_role"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."mon_role"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mon_role"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."mon_role"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."pays_du_produit"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."pays_du_produit"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."pays_du_produit"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."pays_du_produit"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."protege_fiche_agent"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."protege_fiche_agent"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."protege_fiche_agent"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."protege_fiche_agent"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."protege_fiche_livreur"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."protege_fiche_livreur"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."protege_fiche_livreur"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."protege_fiche_livreur"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."rattacher_produit_pays"(uuid, uuid[]) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."rattacher_produit_pays"(uuid, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rattacher_produit_pays"(uuid, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."rattacher_produit_pays"(uuid, uuid[]) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."receptionner_expedition"(uuid, timestamp WITH time zone, uuid, jsonb) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."receptionner_expedition"(uuid, timestamp WITH time zone, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."receptionner_expedition"(uuid, timestamp WITH time zone, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."receptionner_expedition"(uuid, timestamp WITH time zone, uuid, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reglement_modifiable"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."reglement_modifiable"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglement_modifiable"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglement_modifiable"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reglement_visible"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."reglement_visible"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglement_visible"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglement_visible"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reglements_garde"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."reglements_garde"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglements_garde"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglements_garde"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reglements_lignes_garde"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."reglements_lignes_garde"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglements_lignes_garde"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglements_lignes_garde"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reglements_reference"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."reglements_reference"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglements_reference"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reglements_reference"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_tenant_id"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_tenant_id"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_tenant_id"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_tenant_id"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_tenant_id_auto"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_tenant_id_auto"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_tenant_id_auto"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_tenant_id_auto"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."source_m_appartient"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."source_m_appartient"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."source_m_appartient"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."source_m_appartient"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."stats_dashboard"(uuid, timestamp WITH time zone, timestamp WITH time zone) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."stats_dashboard"(uuid, timestamp WITH time zone, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."stats_dashboard"(uuid, timestamp WITH time zone, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."stats_dashboard"(uuid, timestamp WITH time zone, timestamp WITH time zone) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."statut_cible"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."statut_cible"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."statut_cible"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."statut_cible"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."supprimer_pays"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."supprimer_pays"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."supprimer_pays"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."supprimer_pays"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_nom_vers_user_roles"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."sync_nom_vers_user_roles"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_nom_vers_user_roles"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_nom_vers_user_roles"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."unaccent_simple"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."unaccent_simple"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."unaccent_simple"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."unaccent_simple"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."valider_commande_trigger"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."valider_commande_trigger"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."valider_commande_trigger"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."valider_commande_trigger"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."vider_donnees_operationnelles"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."vider_donnees_operationnelles"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."vider_donnees_operationnelles"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."vider_donnees_operationnelles"(uuid) TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."commandes_tracking_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."commandes_tracking_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."commandes_tracking_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."commandes_tracking_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."expeditions_numero_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."expeditions_numero_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."expeditions_numero_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."expeditions_numero_seq" TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."reglements_numero_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."reglements_numero_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."reglements_numero_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."reglements_numero_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."agents" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."agents" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."agents" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."agents" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."appels" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."appels" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."appels" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."appels" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."commandes" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."commandes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."commandes" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."commandes" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."entrepots" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."entrepots" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."entrepots" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."entrepots" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expeditions" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."expeditions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expeditions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expeditions" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expeditions_produits" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."expeditions_produits" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expeditions_produits" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expeditions_produits" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."imports_bruts" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."imports_bruts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."imports_bruts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."imports_bruts" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."livraisons" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."livraisons" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."livraisons" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."livraisons" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."livreurs" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."livreurs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."livreurs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."livreurs" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."motifs_retour" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."motifs_retour" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."motifs_retour" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."motifs_retour" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."mouvements_stock" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."mouvements_stock" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."mouvements_stock" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."mouvements_stock" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."paiements" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."paiements" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."paiements" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."paiements" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pays" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."pays" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pays" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pays" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."permissions" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."permissions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."permissions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."permissions" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."produits" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."produits" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."produits" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."produits" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reglements" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."reglements" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reglements" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reglements" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reglements_commandes" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."reglements_commandes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reglements_commandes" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reglements_commandes" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."role_permissions" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."role_permissions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."role_permissions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."role_permissions" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."roles" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."roles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."roles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."roles" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sources_import" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."sources_import" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sources_import" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sources_import" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."statuts" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."statuts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."statuts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."statuts" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stocks" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."stocks" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stocks" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stocks" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tenants" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."tenants" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tenants" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tenants" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_roles" TO "authenticated";

REVOKE ALL ON TABLE "public"."user_roles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_roles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_roles" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."zones" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."zones" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."zones" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."zones" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_caisses_livreur" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."v_caisses_livreur" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_caisses_livreur" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_caisses_livreur" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_commandes_a_assigner" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."v_commandes_a_assigner" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_commandes_a_assigner" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_commandes_a_assigner" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_commandes_a_regler" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."v_commandes_a_regler" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_commandes_a_regler" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_commandes_a_regler" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_options_filtres" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."v_options_filtres" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_options_filtres" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_options_filtres" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_pays_livrables" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."v_pays_livrables" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_pays_livrables" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."v_pays_livrables" TO "service_role";

