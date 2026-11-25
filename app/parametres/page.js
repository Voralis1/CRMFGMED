"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { libelleStatut } from "../../lib/libellesStatuts.mjs";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../context/PermissionsContext";
import { useMessages } from "../components/Messages";
import { messageErreur } from "../../lib/messageErreur.mjs";
import { useLangue } from "../context/LangueContext";
import { retirerImage } from "../../lib/imageProduit";
import DelaiReaffectation from "../components/DelaiReaffectation";
import { PAYS_MONDE } from "../../lib/paysMonde";

// Un identifiant de commande dans la raison d'un mouvement de stock (20/11).
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
import { fuseauxDuPays, decalageUTC, heureLocale, nomFuseau } from "../../lib/fuseauxPays.mjs";

// Les plus récents seulement : la liste sert à retrouver un mouvement, pas à
// tout recharger à chaque visite.
const MOUVEMENTS_AFFICHES = 200;

const LIBELLE_MOUVEMENT = {
  entree: "Entrée",
  sortie: "Sortie",
  retour_ok: "Retour client (remis en stock)",
  retour_defaut: "Retour client (défectueux)",
  ajustement: "Ajustement inventaire",
};

export default function ParametresAdmin() {
  const { user, tenantId, loading: authLoading } = useAuth();
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions();
  // Messages du CRM (24/11) au lieu du bandeau de la page et des fenêtres du navigateur.
  const { annoncer, confirmer } = useMessages();
  // Les textes suivent la langue choisie (25/11).
  const { t, locale } = useLangue();

  // Qui configure l'entreprise : pays, zones, statuts, entrepôts, stock. Rien
  // de tout cela n'appartient à un vendeur externe — ce sont les réglages de
  // FGMED, pas les siens. Un seller qui pouvait créer un pays pouvait aussi en
  // créer un deuxième mal écrit, et casser l'affectation des agents.
  //
  // Un seul mot pour toute la page : le découper par onglet finissait toujours
  // par laisser un onglet dehors.
  // Deux questions, deux réponses — les confondre, c'était fermer la page au
  // ceo alors qu'il doit voir les chiffres de l'entreprise (fiche §8).
  //
  //   voir     : admin, manager, ceo, super_admin
  //   modifier : admin, manager, super_admin — le ceo est en lecture seule
  //
  // La base dit déjà la même chose (`rls_parametres.sql` : `est_responsable()`
  // lit, `gere_la_config()` écrit). L'écran s'accorde avec elle, au lieu
  // d'inventer sa propre règle.
  const ROLES_VOIR_CONFIG = ['admin', 'manager', 'ceo', 'super_admin'];
  const ROLES_MODIFIER_CONFIG = ['admin', 'manager', 'super_admin'];
  const monRole = String(roleNom || '').toLowerCase();
  const peutConfigurer = ROLES_VOIR_CONFIG.includes(monRole);
  const peutModifier = ROLES_MODIFIER_CONFIG.includes(monRole);
  // Les entrepôts suivent la règle d'écriture ; le nom reste, il est utilisé
  // partout plus bas dans la page.
  const peutGererEntrepots = peutModifier;
  // Frais vendeurs (frais_vendeurs.sql) : l'ADMIN seul les écrit (sa décision
  // 05/11) ; manager et ceo les lisent. La base refuse déjà les autres.
  const peutModifierFrais = ['admin', 'super_admin'].includes(monRole);
  const router = useRouter();

  const [ongletActif, setOngletActif] = useState("pays");
  const [chargement, setChargement] = useState(true);

  // --- États Frais vendeurs ---
  const [listeTarifs, setListeTarifs] = useState([]);
  const [listeVendeurs, setListeVendeurs] = useState([]);
  const TARIF_VIDE = { pays_id: "", vendeur_id: "", frais_commande: "", frais_livraison: "", frais_upsell_unite: "", frais_transfert_pct: "", valide_depuis: "" };
  const [nouveauTarif, setNouveauTarif] = useState(TARIF_VIDE);

  // --- États Pays ---
  const [listePays, setListePays] = useState([]);
  const [nouveauPays, setNouveauPays] = useState({ id: null, nom: "", code: "", devise: "", fuseau: "" });
  const [isEditingPays, setIsEditingPays] = useState(false);

  // --- États Zones ---
  const [listeZones, setListeZones] = useState([]);
  // Pas de frais de livraison (04/11, sa décision) : les livreurs sont salariés. La colonne reste en base, à 0.
  const [nouvelleZone, setNouvelleZone] = useState({ id: null, nom_zone: "", pays_id: "" });
  const [isEditingZone, setIsEditingZone] = useState(false);

  // --- États Statuts ---
  const [listeStatuts, setListeStatuts] = useState([]);
  const [nouveauStatut, setNouveauStatut] = useState({ id: null, nom: "", couleur: "#2C3B4D", pays_id: "", necessite_rappel: false, declenche_assignation: false, ferme_le_lead: false });
  const [isEditingStatut, setIsEditingStatut] = useState(false);

  // --- États Produits ---
  const [listeProduits, setListeProduits] = useState([]);

  // --- États Entrepôts ---
  const [listeEntrepots, setListeEntrepots] = useState([]);
  const [nouvelEntrepot, setNouvelEntrepot] = useState({ ville: "", pays_id: "" });

  // --- États Stocks & Mouvements ---
  const [listeStocks, setListeStocks] = useState([]);
  // L'historique de TOUTE l'entreprise, ici, à côté de là où on déclare un
  // mouvement. Un produit supprimé n'a plus de fiche dans Produits : c'est le
  // seul endroit où ses mouvements restent lisibles.
  const [listeMouvements, setListeMouvements] = useState([]);
  // id de commande → « FG0000000449 » (20/11) : la raison d'un mouvement
  // (« Livraison commande <uuid> ») s'affiche avec une référence lisible.
  const [refsCommandes, setRefsCommandes] = useState({});
  const [nouveauMouvement, setNouveauMouvement] = useState({
    produit_id: "", entrepot_id: "", type_mouvement: "entree", quantite: 1, notes: ""
  });

  // --- REDIRECTION SÉCURISÉE ---
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace("/");
      } else if (!hasPermission("menu_parametres")) {
        router.replace("/dashboard");
      } else if (tenantId && peutConfigurer) {
        chargerDonnees();
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, tenantId, router, peutConfigurer]);

  async function chargerDonnees() {
    if (!tenantId || !peutConfigurer) return;
    setChargement(true);

    const { data: paysData } = await supabase.from("pays").select("*").eq("tenant_id", tenantId).order("nom");
    if (paysData) setListePays(paysData);

    const { data: zonesData } = await supabase.from("zones").select("*, pays(nom, devise)").eq("tenant_id", tenantId).order("nom_zone");
    if (zonesData) setListeZones(zonesData);

    const { data: statutsData } = await supabase.from("statuts").select("*, pays(nom)").eq("tenant_id", tenantId).order("nom");
    if (statutsData) setListeStatuts(statutsData);

    const { data: produitsData } = await supabase.from("produits").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (produitsData) setListeProduits(produitsData);

    const { data: entrepotsData } = await supabase.from("entrepots").select("*").eq("tenant_id", tenantId).order("nom");
    if (entrepotsData) setListeEntrepots(entrepotsData);

    const { data: stocksData } = await supabase.from("stocks").select("*, produits(product, code), entrepots(nom)").eq("tenant_id", tenantId);
    if (stocksData) setListeStocks(stocksData);

    // Le nom écrit sur le mouvement (produit_nom) sert quand le produit
    // n'existe plus : produit_id est alors NULL (produits_historique_nom.sql).
    const { data: mouvementsData } = await supabase.from("mouvements_stock")
      .select("id, created_at, type_mouvement, quantite, notes, produit_id, produit_nom, produit_code, entrepots(nom), produits(product, code)")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(MOUVEMENTS_AFFICHES);
    if (mouvementsData) {
      setListeMouvements(mouvementsData);
      const ids = [...new Set(mouvementsData.flatMap((m) => String(m.notes || "").match(UUID_G) || []))];
      if (ids.length) {
        const { data: cmds } = await supabase.from("commandes").select("id, lead_id, tracking_number").in("id", ids);
        setRefsCommandes(Object.fromEntries((cmds || []).map((c) => [c.id, c.tracking_number || c.lead_id || c.id.slice(0, 8)])));
      }
    }

    // Table absente (frais_vendeurs.sql pas encore lancé) : l'onglet reste vide.
    const { data: tarifsData } = await supabase.from("tarifs_vendeurs")
      .select("id, pays_id, vendeur_id, frais_commande, frais_livraison, frais_upsell_unite, frais_transfert_pct, valide_depuis, pays(nom, devise)")
      .eq("tenant_id", tenantId).order("valide_depuis", { ascending: false });
    setListeTarifs(tarifsData || []);

    const { data: vendeursData } = await supabase.from("user_roles")
      .select("user_id, nom, email, role").eq("tenant_id", tenantId);
    setListeVendeurs((vendeursData || []).filter((v) => String(v.role || '').toLowerCase() === 'seller'));

    setChargement(false);
  }

  // =====================================================================
  // ACTIONS PAYS
  // =====================================================================

  // « maroc », « MAROC » et « Maroc  » sont le même pays. Pour la base, non :
  // trois lignes, trois identifiants. Un agent rattaché à l'une ne reçoit
  // jamais les leads de l'autre, et rien ne lève d'erreur.
  //
  // On met donc le nom en forme ici, et un index unique sur
  // (tenant_id, lower(btrim(nom))) refuse la seconde graphie en base
  // (`pays_doublons.sql`). L'écran évite la faute, la base l'interdit : sans
  // les deux, un import ou un autre écran la referait.
  function nomPaysPropre(brut) {
    const n = String(brut || "").trim().replace(/\s+/g, " ");
    // Seule la première lettre est touchée : « RDC » doit rester « RDC », et
    // « Côte d'Ivoire » ne doit pas devenir « Côte D'ivoire ».
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : n;
  }

  // 23505 = violation d'unicité. C'est l'index ci-dessus qui parle : le pays
  // existe déjà sous une autre graphie. Le dire, au lieu d'« Erreur ».
  function messagePays(error, action) {
    if (error.code === "23505") return t('par.paysExiste');
    return t(action === "la modification" ? "par.erreurModif" : "par.erreurAjout", { erreur: messageErreur(error) });
  }

  async function ajouterPays(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauPays.nom || !nouveauPays.code || !nouveauPays.devise) return afficherMessage(t('par.paysChamps'), "erreur");
    // 13/11 (fuseaux_pays.sql) : le fuseau vient de la liste officielle ; un pays
    // à plusieurs fuseaux demande un choix. La base refuse pareil.
    const fuseauxPossibles = fuseauxDuPays(nouveauPays.code);
    if (fuseauxPossibles.length === 0) return afficherMessage(t("par.codeInconnu", { code: nouveauPays.code }), "erreur");
    if (!nouveauPays.fuseau || !fuseauxPossibles.includes(nouveauPays.fuseau)) return afficherMessage(t('par.choisirFuseau'), "erreur");

    const champs = {
      nom: nomPaysPropre(nouveauPays.nom),
      code: nouveauPays.code.trim().toUpperCase(),
      devise: nouveauPays.devise.trim().toUpperCase(),
      fuseau: nouveauPays.fuseau,
    };

    if (isEditingPays) {
      const { error } = await supabase.from("pays").update(champs).eq("id", nouveauPays.id).eq("tenant_id", tenantId);
      if (error) afficherMessage(messagePays(error, "la modification"), "erreur");
      else { afficherMessage(t('par.paysModifie'), "succes"); annulerEditionPays(); chargerDonnees(); }
    } else {
      const { error } = await supabase.from("pays").insert([{ ...champs, tenant_id: tenantId }]);
      if (error) afficherMessage(messagePays(error, "l'ajout"), "erreur");
      else { afficherMessage(t('par.paysAjoute'), "succes"); setNouveauPays({ id: null, nom: "", code: "", devise: "", fuseau: "" }); chargerDonnees(); }
    }
  }

  function preparerModificationPays(pays) { setNouveauPays({ id: pays.id, nom: pays.nom || "", code: pays.code || "", devise: pays.devise || "", fuseau: pays.fuseau || "" }); setIsEditingPays(true); }
  function annulerEditionPays() { setNouveauPays({ id: null, nom: "", code: "", devise: "", fuseau: "" }); setIsEditingPays(false); }
  // Choisir un pays dans la liste : nom et code justes, et le fuseau proposé
  // (posé tout seul s'il n'y en a qu'un).
  function choisirPaysMonde(code) {
    const m = PAYS_MONDE.find((x) => x.code === code);
    if (!m) { setNouveauPays({ ...nouveauPays, nom: "", code: "", fuseau: "" }); return; }
    const f = fuseauxDuPays(m.code);
    setNouveauPays({ ...nouveauPays, nom: m.nom, code: m.code, fuseau: f.length === 1 ? f[0] : "" });
  }
  // La suppression est faite par la base (`supprimer_pays`), pas ici.
  //
  // Un `delete` depuis l'écran échouait sur la première ligne qui citait le
  // pays, et l'ancienne version jetait ce refus à la poubelle : on cliquait,
  // rien ne se passait, et rien ne disait pourquoi. Le cas qui l'a révélé :
  // un livreur supprimé depuis l'application garde sa fiche (sans compte,
  // inactive) pour que l'historique des livraisons tienne — et cette fiche
  // fantôme retenait le pays indéfiniment.
  //
  // La fonction tranche : ce qui est du travail réel bloque et elle le nomme ;
  // ce qui n'existe que par le pays (ses zones, ses statuts, son entrepôt
  // vide, ses fiches archivées que personne ne cite) part avec lui.
  async function supprimerPays(id, nom) {
    if (!tenantId) return;
    if (!(await confirmer({
      titre: t('par.supprimerPays'),
      message: t('par.supprimerPaysMsg', { nom }),
      bouton: t('par.supprimer'), danger: true,
    }))) return;

    const { data, error } = await supabase.rpc("supprimer_pays", { p_pays: id });
    if (error) return afficherMessage(messageErreur(error), "erreur");
    afficherMessage(data || t("par.paysSupprime", { nom }), "succes");
    chargerDonnees();
  }

  // =====================================================================
  // ACTIONS ZONES
  // =====================================================================
  async function ajouterZone(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouvelleZone.nom_zone || !nouvelleZone.pays_id) return afficherMessage(t('par.zoneChamps'), "erreur");

    if (isEditingZone) {
      const { error } = await supabase.from("zones").update({ nom_zone: nouvelleZone.nom_zone.trim(), pays_id: nouvelleZone.pays_id }).eq("id", nouvelleZone.id).eq("tenant_id", tenantId);
      if (error) afficherMessage(t('par.erreurModifCourt'), "erreur");
      else { afficherMessage(t('par.zoneModifiee'), "succes"); annulerEditionZone(); chargerDonnees(); }
    } else {
      const { error } = await supabase.from("zones").insert([{ nom_zone: nouvelleZone.nom_zone.trim(), pays_id: nouvelleZone.pays_id, tenant_id: tenantId }]);
      if (error) afficherMessage(t('par.erreurAjoutCourt'), "erreur");
      else { afficherMessage(t('par.zoneAjoutee'), "succes"); setNouvelleZone({ id: null, nom_zone: "", pays_id: "" }); chargerDonnees(); }
    }
  }

  function preparerModificationZone(zone) { setNouvelleZone({ id: zone.id, nom_zone: zone.nom_zone || "", pays_id: zone.pays_id || "" }); setIsEditingZone(true); }
  function annulerEditionZone() { setNouvelleZone({ id: null, nom_zone: "", pays_id: "" }); setIsEditingZone(false); }
  // 24/11 : fenêtre du CRM, et le résultat est lu (avant, un refus passait pour un succès muet).
  async function supprimerZone(id) {
    if (!tenantId || !(await confirmer({ titre: t('par.supprimerZone'), message: t('par.supprimerZoneMsg'), bouton: t('par.supprimer'), danger: true }))) return;
    const { data, error } = await supabase.from("zones").delete().eq("id", id).eq("tenant_id", tenantId).select("id");
    if (error) afficherMessage(t('par.suppressionRefusee', { erreur: messageErreur(error) }), "erreur");
    else if (!data || data.length === 0) afficherMessage(t('par.suppressionRefuseeCourt'), "erreur");
    else afficherMessage(t('par.zoneSupprimee'), "succes");
    chargerDonnees();
  }

  // =====================================================================
  // ACTIONS STATUTS
  // =====================================================================
  async function ajouterStatut(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauStatut.nom || !nouveauStatut.pays_id) return afficherMessage(t('par.statutChamps'), "erreur");

    if (isEditingStatut) {
      const { error } = await supabase.from("statuts").update({ nom: nouveauStatut.nom.trim(), couleur: nouveauStatut.couleur, pays_id: nouveauStatut.pays_id, necessite_rappel: nouveauStatut.necessite_rappel, declenche_assignation: nouveauStatut.declenche_assignation, ferme_le_lead: nouveauStatut.ferme_le_lead }).eq("id", nouveauStatut.id).eq("tenant_id", tenantId);
      if (error) afficherMessage(t('par.erreurModifCourt'), "erreur");
      else { afficherMessage(t('par.statutModifie'), "succes"); annulerEditionStatut(); chargerDonnees(); }
    } else {
      const codeGenere = nouveauStatut.nom.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s_]/g, "").replace(/\s+/g, "_");
      const { error } = await supabase.from("statuts").insert([{ nom: nouveauStatut.nom.trim(), code: codeGenere, couleur: nouveauStatut.couleur, pays_id: nouveauStatut.pays_id, tenant_id: tenantId, necessite_rappel: nouveauStatut.necessite_rappel, declenche_assignation: nouveauStatut.declenche_assignation, ferme_le_lead: nouveauStatut.ferme_le_lead }]);
      if (error) afficherMessage(t('par.erreur', { erreur: messageErreur(error) }), "erreur");
      else { afficherMessage(t('par.statutAjoute'), "succes"); setNouveauStatut({ id: null, nom: "", couleur: "#2C3B4D", pays_id: "", necessite_rappel: false, declenche_assignation: false, ferme_le_lead: false }); chargerDonnees(); }
    }
  }

  function preparerModificationStatut(statut) { setNouveauStatut({ id: statut.id, nom: statut.nom || "", couleur: statut.couleur || "#2C3B4D", pays_id: statut.pays_id || "", necessite_rappel: statut.necessite_rappel || false, declenche_assignation: statut.declenche_assignation || false, ferme_le_lead: statut.ferme_le_lead || false }); setIsEditingStatut(true); }
  function annulerEditionStatut() { setNouveauStatut({ id: null, nom: "", couleur: "#2C3B4D", pays_id: "", necessite_rappel: false, declenche_assignation: false, ferme_le_lead: false }); setIsEditingStatut(false); }
  async function supprimerStatut(id) {
    if (!tenantId || !(await confirmer({ titre: t('par.supprimerStatut'), message: t('par.supprimerStatutMsg'), bouton: t('par.supprimer'), danger: true }))) return;
    const { data, error } = await supabase.from("statuts").delete().eq("id", id).eq("tenant_id", tenantId).select("id");
    if (error) afficherMessage(t('par.suppressionRefusee', { erreur: messageErreur(error) }), "erreur");
    else if (!data || data.length === 0) afficherMessage(t('par.suppressionRefuseeCourt'), "erreur");
    else afficherMessage(t('par.statutSupprime'), "succes");
    chargerDonnees();
  }

  // =====================================================================
  // ACTIONS PRODUITS
  // =====================================================================
  // L'erreur n'était pas lue : un refus de la base passait pour un succès muet.
  // L'image d'abord (26/10), comme l'écran Produits : la base ne sait pas
  // supprimer un fichier, et une fois le produit parti plus personne n'a le
  // droit de toucher au sien. Sans ça, ce bouton serait la source d'orphelins.
  async function supprimerProduit(pr) {
    if (!tenantId || !(await confirmer({ titre: t('par.supprimerProduit'), message: t('par.supprimerProduitMsg'), bouton: t('par.supprimer'), danger: true }))) return;
    if (pr.image_chemin) {
      const err = await retirerImage(pr.image_chemin);
      if (err) return afficherMessage(t('par.supprAnnulee', { erreur: err }), "erreur");
    }
    const { error } = await supabase.from("produits").delete().eq("id", pr.id).eq("tenant_id", tenantId);
    if (error) {
      // Le fichier est déjà parti : le produit ne doit plus le désigner.
      if (pr.image_chemin) await supabase.from("produits").update({ image_chemin: null }).eq("id", pr.id).eq("tenant_id", tenantId);
      afficherMessage(t('par.suppressionRefusee', { erreur: messageErreur(error) }), "erreur");
    } else afficherMessage(t('par.produitSupprimeMsg'), "succes");
    chargerDonnees();
  }

  // =====================================================================
  // ACTIONS ENTREPÔTS & MOUVEMENTS
  // =====================================================================
  async function ajouterEntrepot(e) {
    e.preventDefault();
    if (!tenantId) return;
    // Un entrepôt EST un pays. Un seul par pays, nommé comme lui.
    //
    // Avant, on demandait aussi une ville : deux dépôts au Maroc, et le
    // vendeur qui n'en choisit qu'un (le pays) laissait la question « lequel a
    // reçu ? » sans réponse — à l'import comme à la réception d'une
    // expédition. Un pays, un dépôt : la question ne se pose plus.
    if (!nouvelEntrepot.pays_id) return afficherMessage(t('par.choisirPaysEntrepot'), "erreur");

    const pays = listePays.find((p) => p.id === nouvelEntrepot.pays_id);
    const { error } = await supabase.from("entrepots").insert([{
      // `nom` et `localisation` portent le nom du pays : des écrans lisent
      // encore l'un ou l'autre, et les laisser différents ferait apparaître
      // deux noms pour le même dépôt.
      nom: pays?.nom || "", localisation: pays?.nom || "",
      pays_id: nouvelEntrepot.pays_id, tenant_id: tenantId,
    }]);
    if (error) {
      // 23505 = l'index unique (tenant_id, pays_id). C'est lui qui parle.
      afficherMessage(
        error.code === "23505"
          ? t("par.dejaEntrepot", { pays: pays?.nom || t("par.cePays") })
          : t('par.erreurEntrepot', { erreur: messageErreur(error) }),
        "erreur",
      );
    } else {
      afficherMessage(t('par.entrepotAjoute'), "succes");
      setNouvelEntrepot({ ville: "", pays_id: "" });
      chargerDonnees();
    }
  }

  async function supprimerEntrepot(entrepot) {
    if (!tenantId) return;
    // On annonce ce qui disparaît AVEC lui. Un entrepôt tient des lignes de
    // stock et un historique de mouvements : les emporter sans le dire,
    // c'est faire perdre des quantités sans que personne ne sache où.
    const [{ count: nbStocks }, { count: nbMouvements }] = await Promise.all([
      supabase.from("stocks").select("id", { count: "exact", head: true })
        .eq("entrepot_id", entrepot.id).eq("tenant_id", tenantId),
      supabase.from("mouvements_stock").select("id", { count: "exact", head: true })
        .eq("entrepot_id", entrepot.id).eq("tenant_id", tenantId),
    ]);

    // Un entrepôt avec un historique de mouvements ne se supprime pas (11/11, T22 :
    // supprimer effaçait tout son historique — la base refuse aussi, stock_portes.sql).
    if (nbMouvements) {
      return afficherMessage(t("par.entrepotHistorique", { nom: entrepot.nom, n: nbMouvements }), "erreur");
    }

    const emporte = [];
    if (nbStocks) emporte.push(t("par.lignesStock", { n: nbStocks }));
    if (nbMouvements) emporte.push(t("par.mouvements", { n: nbMouvements }));

    if (!(await confirmer({ titre: t('par.supprimerEntrepot'), bouton: t('par.supprimer'), danger: true, message:
      t("par.supprimerEntrepotMsg", { nom: entrepot.nom }) + "\n\n" +
      (emporte.length
        ? t("par.emporte", { liste: emporte.join(t("par.et")) }) + "\n\n"
        : "") +
      t('par.conservees')
    }))) return;

    // Dans cet ordre : les mouvements, puis les stocks, puis l'entrepôt.
    // L'inverse échouerait sur une clé étrangère, à mi-chemin.
    if (nbMouvements) {
      const { error } = await supabase.from("mouvements_stock").delete()
        .eq("entrepot_id", entrepot.id).eq("tenant_id", tenantId);
      if (error) return afficherMessage(t('par.suppMouvRefusee', { erreur: messageErreur(error) }), "erreur");
    }
    if (nbStocks) {
      const { error } = await supabase.from("stocks").delete()
        .eq("entrepot_id", entrepot.id).eq("tenant_id", tenantId);
      if (error) return afficherMessage(t('par.suppStockRefusee', { erreur: messageErreur(error) }), "erreur");
    }
    const { error } = await supabase.from("entrepots").delete()
      .eq("id", entrepot.id).eq("tenant_id", tenantId);
    if (error) afficherMessage(t('par.suppressionRefusee', { erreur: messageErreur(error) }), "erreur");
    else { afficherMessage(t('par.entrepotSupprime'), "succes"); chargerDonnees(); }
  }

  // Corriger le pays d'un entrepôt existant, directement dans la liste.
  // Les entrepôts créés avant que cette colonne existe n'en ont aucun.
  async function changerPaysEntrepot(id, paysId) {
    if (!tenantId) return;
    const pays = listePays.find((p) => p.id === paysId);
    // Le nom suit le pays : un dépôt « Maroc » rattaché à l'Angola porterait
    // un nom qui mentirait sur tous les autres écrans.
    const champs = paysId
      ? { pays_id: paysId, nom: pays?.nom || "", localisation: pays?.nom || "" }
      : { pays_id: null };

    const { error } = await supabase.from("entrepots").update(champs).eq("id", id).eq("tenant_id", tenantId);
    if (error) {
      afficherMessage(
        error.code === "23505"
          ? t("par.dejaEntrepot", { pays: pays?.nom || t("par.cePays") })
          : t('par.erreur', { erreur: messageErreur(error) }),
        "erreur",
      );
    } else { afficherMessage(t('par.paysEntrepotEnregistre'), "succes"); chargerDonnees(); }
  }

  async function ajouterMouvement(e) {
    e.preventDefault();
    if (!tenantId) return;
    if (!nouveauMouvement.produit_id || !nouveauMouvement.entrepot_id) return afficherMessage(t('par.mouvChamps'), "erreur");

    const { error } = await supabase.from("mouvements_stock").insert([{
      ...nouveauMouvement,
      quantite: parseInt(nouveauMouvement.quantite),
      tenant_id: tenantId
    }]);

    if (error) afficherMessage(t('par.erreur', { erreur: messageErreur(error) }), "erreur");
    else {
      afficherMessage(t('par.mouvEnregistre'), "succes");
      setNouveauMouvement({ produit_id: "", entrepot_id: "", type_mouvement: "entree", quantite: 1, notes: "" });
      chargerDonnees();
    }
  }

  // --- UTILITAIRES ---
  function afficherMessage(texte, type) {
    annoncer(texte, type === "succes" ? "succes" : type === "erreur" ? "erreur" : "info");
  }

  // --- FRAIS VENDEURS ---
  // On n'écrase jamais une ligne : un changement de frais = une nouvelle ligne
  // avec sa date de début. Les relevés déjà établis gardent leurs frais.
  async function ajouterTarif(e) {
    e.preventDefault();
    if (!tenantId || !peutModifierFrais) return;
    const tarif = nouveauTarif;
    if (!tarif.pays_id) return afficherMessage(t('par.choisirPays'), "erreur");
    const montants = [tarif.frais_commande, tarif.frais_livraison, tarif.frais_upsell_unite].map((x) => Number(x || 0));
    if (montants.some((x) => !Number.isFinite(x) || x < 0)) return afficherMessage(t('par.montantsInvalides'), "erreur");
    // Frais de transfert (retenues_releve.sql, 09/11) : un %, 0 = aucun.
    const pct = Number(tarif.frais_transfert_pct || 0);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return afficherMessage(t('par.transfertInvalide'), "erreur");
    const ligne = {
      tenant_id: tenantId, pays_id: tarif.pays_id, vendeur_id: tarif.vendeur_id || null,
      frais_commande: montants[0], frais_livraison: montants[1], frais_upsell_unite: montants[2],
      frais_transfert_pct: pct,
    };
    if (tarif.valide_depuis) ligne.valide_depuis = tarif.valide_depuis;
    const { error } = await supabase.from("tarifs_vendeurs").insert([ligne]);
    if (error) {
      afficherMessage(error.code === "23505" ? t('par.ligneExiste') : t('par.erreur', { erreur: messageErreur(error) }), "erreur");
      return;
    }
    afficherMessage(t('par.fraisEnregistres'), "succes");
    setNouveauTarif(TARIF_VIDE);
    chargerDonnees();
  }

  async function supprimerTarif(id) {
    if (!tenantId || !peutModifierFrais) return;
    if (!(await confirmer({ titre: t('par.supprimerFrais'), message: t('par.supprimerFraisMsg'), bouton: t('par.supprimer'), danger: true }))) return;
    const { data, error } = await supabase.from("tarifs_vendeurs").delete().eq("id", id).eq("tenant_id", tenantId).select("id");
    if (error) return afficherMessage(t('par.erreur', { erreur: messageErreur(error) }), "erreur");
    if (!data || data.length === 0) return afficherMessage(t('par.suppressionRefuseeCourt'), "erreur");
    afficherMessage(t('par.ligneSupprimee'), "succes");
    chargerDonnees();
  }

  const nomVendeurTarif = (id) => {
    if (!id) return t('par.tousVendeurs');
    const v = listeVendeurs.find((x) => x.user_id === id);
    return v ? (v.nom || v.email) : t('par.vendeurSupprime');
  };

  // --- ICÔNES DES ONGLETS ---
  const TAB_ICONS = {
    pays: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
    zones: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>
      </svg>
    ),
    statuts: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
    produits: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    ),
    entrepots: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/><path d="M3 21h18"/>
      </svg>
    ),
    stocks: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
    ),
    frais: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>
      </svg>
    ),
  };

  // Un onglet masqué ne doit pas rester affiché parce qu'il était ouvert
  // avant que le rôle soit connu : on ramène sur le premier onglet.
  useEffect(() => {
    if (!permsLoading && !peutGererEntrepots && ongletActif === "entrepots") {
      setOngletActif("pays");
    }
  }, [permsLoading, peutGererEntrepots, ongletActif]);

  // --- BOUTON ONGLET (style pilule) ---
  const TabButton = ({ id, label }) => (
    <button
      onClick={() => setOngletActif(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-left transition-colors cursor-pointer whitespace-nowrap border ${
        ongletActif === id
          ? "bg-[#1B2632] text-white border-[#1B2632] shadow-sm"
          : "bg-white text-[#1B2632] border-[#C9C1B1]/70 hover:border-[#1B2632]/40"
      }`}
    >
      <span className={`shrink-0 ${ongletActif === id ? "text-[#FFB162]" : "text-[#A35139]"}`}>
        {TAB_ICONS[id]}
      </span>
      <span className="font-semibold text-sm leading-tight">{label}</span>
    </button>
  );

  // --- ÉCRAN DE CHARGEMENT ---
  if (authLoading || permsLoading || !hasPermission("menu_parametres")) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">{t('par.verif')}</div>;
  }

  // Page vide pour qui ne configure pas. Vide pour de vrai : aucun onglet, et
  // `chargerDonnees()` n'est même pas appelé — on ne charge pas une liste de
  // pays ou d'entrepôts pour la masquer ensuite côté navigateur.
  if (!peutConfigurer) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10 pt-4 sm:pt-16 px-4 sm:px-6">
        <header className="border-b border-[#C9C1B1]/50 pb-4">
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">{t('par.administration')}</p>
          <h1 className="text-3xl font-bold text-[#1B2632]">{t('par.titre')}</h1>
        </header>
        <div className="bg-white border border-[#C9C1B1] rounded-2xl px-8 py-16 text-center">
          <p className="text-sm font-semibold text-[#1B2632]">{t('par.rienARegler')}</p>
          <p className="text-sm text-[#1B2632]/60 mt-2 max-w-md mx-auto">
            {t("par.reglagesAide")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10 pt-4 sm:pt-16 px-4 sm:px-6">
      <StyleParametres />

      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        {/* En-tête compact (20/11) ; onglets courts qui tiennent sur une ligne.
            « Catalogue Produits » retiré : tout se fait dans le menu Produits. */}
        <h1 className="text-2xl font-bold text-[#1B2632]">{t('par.titre')}</h1>

        <div className="flex flex-wrap gap-2">
          <TabButton id="pays" label={t("par.onglet.pays")} />
          <TabButton id="zones" label={t("par.onglet.zones")} />
          <TabButton id="statuts" label={t("par.onglet.statuts")} />
          {peutGererEntrepots && <TabButton id="entrepots" label={t("par.onglet.entrepots")} />}
          <TabButton id="stocks" label={t("par.onglet.stocks")} />
          <TabButton id="frais" label={t("par.onglet.frais")} />
        </div>
      </header>

      {!peutModifier && (
        <div className="px-5 py-3 rounded-xl bg-[#FFB162]/10 border border-[#FFB162]/40 text-sm text-[#8a5a1f] font-medium">
          {t('par.lectureSeule')}
        </div>
      )}

      <main className="w-full">
        {/* `disabled` sur un fieldset désactive TOUT ce qu'il contient, champs
            et boutons. Une seule ligne, et aucun formulaire ne peut être
            oublié — les ajouter un par un, c'en laisser un ouvert au prochain
            onglet ajouté. `display: contents` pour que la mise en page ne
            bouge pas d'un pixel.
            La base refuse déjà ces écritures au ceo ; ici on évite surtout de
            lui faire remplir un formulaire pour rien. */}
        <fieldset disabled={!peutModifier} className="contents">

        {/* --- ONGLET PAYS --- */}
        {ongletActif === "pays" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">
                  {isEditingPays ? t('par.modifierPays') : t('par.gestionPays')}
                </h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">{t('par.paysAide')}</p>
              </div>

              <form onSubmit={ajouterPays} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                {/* 13/11 : le pays se CHOISIT dans la liste (nom et code ISO justes) ;
                    le fuseau horaire en découle (base officielle, lib/fuseauxPays.mjs). */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.pays')}</label>
                  <select value={PAYS_MONDE.some((m) => m.code === nouveauPays.code) ? nouveauPays.code : ""} onChange={(e) => choisirPaysMonde(e.target.value)} className="fg-input cursor-pointer" required>
                    <option value="">{nouveauPays.nom && !PAYS_MONDE.some((m) => m.code === nouveauPays.code) ? `${nouveauPays.nom} (hors liste) — choisir…` : "Choisir un pays…"}</option>
                    {PAYS_MONDE.map((m) => (<option key={m.code} value={m.code}>{m.nom}</option>))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.codeIso')}</label>
                  <input type="text" value={nouveauPays.code} readOnly className="fg-input bg-[#EEE9DF]/40" placeholder="auto" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.fuseau')}</label>
                  {(() => {
                    const f = fuseauxDuPays(nouveauPays.code);
                    if (!nouveauPays.code) return <input type="text" readOnly className="fg-input bg-[#EEE9DF]/40" placeholder={t('par.choisissezPays')} />;
                    if (f.length === 0) return <p className="text-xs text-[#A35139] py-2">{t('par.codeInconnuCourt')}</p>;
                    if (f.length === 1) return (
                      <input type="text" readOnly className="fg-input bg-[#EEE9DF]/40" value={`${nomFuseau(f[0])} · ${decalageUTC(f[0])} · ${heureLocale(f[0])}`} />
                    );
                    return (
                      <select value={nouveauPays.fuseau} onChange={(e) => setNouveauPays({ ...nouveauPays, fuseau: e.target.value })} className="fg-input cursor-pointer" required>
                        <option value="">{t('par.plusieursFuseaux')}</option>
                        {f.map((z) => (<option key={z} value={z}>{nomFuseau(z)} · {decalageUTC(z)} · {heureLocale(z)}</option>))}
                      </select>
                    );
                  })()}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.devise')}</label>
                  <input type="text" placeholder={t('par.exDevise')} maxLength={3} value={nouveauPays.devise} onChange={(e) => setNouveauPays({...nouveauPays, devise: e.target.value})} className="fg-input" required />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="fg-btn-primary w-full">
                    {isEditingPays ? t('par.mettreAJour') : t('par.ajouterPays')}
                  </button>
                  {isEditingPays && (
                    <button type="button" onClick={annulerEditionPays} className="px-4 py-2 border border-[#C9C1B1] rounded-xl text-xs font-bold bg-white text-[#1B2632] hover:bg-gray-100 cursor-pointer">
                      {t('par.annuler')}
                    </button>
                  )}
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                <table className="fg-table w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th>{t('par.pays')}</th>
                      <th>{t('par.codeIso')}</th>
                      <th>{t('par.devise')}</th>
                      <th>{t('par.fuseau')}</th>
                      <th className="text-right">{t('par.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargement ? (
                      <tr><td colSpan="5" className="text-center py-6">{t('par.chargement')}</td></tr>
                    ) : listePays.length === 0 ? (
                      <tr><td colSpan="5" className="text-center py-6 text-gray-400">{t('par.aucunPays')}</td></tr>
                    ) : (
                      listePays.map((p) => (
                        <tr key={p.id} className="hover:bg-[#EEE9DF]/20">
                          <td className="font-medium">{p.nom}</td>
                          <td><span className="fg-badge">{p.code}</span></td>
                          <td><span className="fg-badge dark">{p.devise}</span></td>
                          <td className="text-xs whitespace-nowrap">
                            {p.fuseau ? (
                              <span title={p.fuseau}>{nomFuseau(p.fuseau)} · {decalageUTC(p.fuseau)} · <span className="font-semibold">{heureLocale(p.fuseau)}</span></span>
                            ) : <span className="text-[#A35139]">—</span>}
                            {p.fuseau === "UTC" && !fuseauxDuPays(p.code).length && <span className="block text-[#A35139]">{t('par.codeInconnuMin')}</span>}
                          </td>
                          <td className="text-right flex items-center justify-end gap-2">
                            <button onClick={() => preparerModificationPays(p)} className="px-3 py-1 bg-white border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] hover:bg-gray-50 cursor-pointer">
                              {t('par.modifier')}
                            </button>
                            <button onClick={() => supprimerPays(p.id, p.nom)} className="fg-btn-danger">{t('par.supprimer')}</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- ONGLET ZONES DE LIVRAISON --- */}
        {ongletActif === "zones" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">
                  {isEditingZone ? t('par.modifierZone') : t('par.zonesLivraison')}
                </h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">{t('par.zonesAide')}</p>
              </div>

              <form onSubmit={ajouterZone} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.paysRattache')}</label>
                  <select value={nouvelleZone.pays_id} onChange={(e) => setNouvelleZone({...nouvelleZone, pays_id: e.target.value})} className="fg-input cursor-pointer" required>
                    <option value="">{t('par.selectPays')}</option>
                    {listePays.map((p) => (<option key={p.id} value={p.id}>{p.nom}</option>))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.nomZone')}</label>
                  <input type="text" placeholder={t('par.exZone')} value={nouvelleZone.nom_zone} onChange={(e) => setNouvelleZone({...nouvelleZone, nom_zone: e.target.value})} className="fg-input" required />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="fg-btn-primary w-full">
                    {isEditingZone ? t('par.mettreAJour') : t('par.ajouterZone')}
                  </button>
                  {isEditingZone && (
                    <button type="button" onClick={annulerEditionZone} className="px-4 py-2 border border-[#C9C1B1] rounded-xl text-xs font-bold bg-white text-[#1B2632] hover:bg-gray-100 cursor-pointer">
                      {t('par.annuler')}
                    </button>
                  )}
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                <table className="fg-table w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th>{t('par.zone')}</th>
                      <th>{t('par.pays')}</th>
                      <th className="text-right">{t('par.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargement ? (
                      <tr><td colSpan="3" className="text-center py-6">{t('par.chargement')}</td></tr>
                    ) : listeZones.length === 0 ? (
                      <tr><td colSpan="3" className="text-center py-6 text-gray-400">{t('par.aucuneZone')}</td></tr>
                    ) : (
                      listeZones.map((z) => (
                        <tr key={z.id} className="hover:bg-[#EEE9DF]/20">
                          <td className="font-medium">{z.nom_zone}</td>
                          <td>{z.pays?.nom ? <span className="fg-badge">{z.pays.nom}</span> : <span className="text-xs text-[#1B2632]/50">—</span>}</td>
                          <td className="text-right flex items-center justify-end gap-2">
                            <button onClick={() => preparerModificationZone(z)} className="px-3 py-1 bg-white border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] hover:bg-gray-50 cursor-pointer">
                              {t('par.modifier')}
                            </button>
                            <button onClick={() => supprimerZone(z.id)} className="fg-btn-danger">{t('par.supprimer')}</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- ONGLET STATUTS CONFIGURABLES --- */}
        {ongletActif === "statuts" && (
          <div className="flex flex-col gap-6">
            <DelaiReaffectation tenantId={tenantId} peutModifier={peutModifier} />
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">
                  {isEditingStatut ? t('par.modifierStatut') : t('par.statutsAppels')}
                </h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">{t('par.statutsAide')}</p>
              </div>

              <form onSubmit={ajouterStatut} className="flex flex-col gap-4 mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.paysRattache')}</label>
                    <select value={nouveauStatut.pays_id} onChange={(e) => setNouveauStatut({...nouveauStatut, pays_id: e.target.value})} className="fg-input cursor-pointer" required>
                      <option value="">{t('par.selectPays')}</option>
                      {listePays.map((p) => (<option key={p.id} value={p.id}>{p.nom}</option>))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.nomStatut')}</label>
                    <input type="text" placeholder={t('par.exStatut')} value={nouveauStatut.nom} onChange={(e) => setNouveauStatut({...nouveauStatut, nom: e.target.value})} className="fg-input" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.couleurBadge')}</label>
                    <input type="color" value={nouveauStatut.couleur} onChange={(e) => setNouveauStatut({...nouveauStatut, couleur: e.target.value})} className="w-full h-[42px] border border-[#C9C1B1] rounded-xl cursor-pointer bg-white p-1" />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="fg-btn-primary w-full">
                      {isEditingStatut ? t('par.mettreAJour') : t('par.ajouterStatut')}
                    </button>
                    {isEditingStatut && (
                      <button type="button" onClick={annulerEditionStatut} className="px-4 py-2 border border-[#C9C1B1] rounded-xl text-xs font-bold bg-white text-[#1B2632] hover:bg-gray-100 cursor-pointer">
                        {t('par.annuler')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 pt-4 mt-2 border-t border-[#C9C1B1]/40">
                  <label className="flex items-start gap-2.5 cursor-pointer max-w-sm">
                    <input type="checkbox" checked={nouveauStatut.necessite_rappel} onChange={(e) => setNouveauStatut({...nouveauStatut, necessite_rappel: e.target.checked})} className="mt-0.5 w-4 h-4 accent-[#1B2632] cursor-pointer" />
                    <span>
                      <span className="block text-sm font-bold text-[#1B2632]">{t('par.necessiteRappel')}</span>
                      <span className="block text-xs text-[#1B2632]/60">{t('par.necessiteRappelAide')}</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer max-w-sm">
                    <input type="checkbox" checked={nouveauStatut.declenche_assignation} onChange={(e) => setNouveauStatut({...nouveauStatut, declenche_assignation: e.target.checked})} className="mt-0.5 w-4 h-4 accent-[#1B2632] cursor-pointer" />
                    <span>
                      <span className="block text-sm font-bold text-[#1B2632]">{t('par.declencheAssign')}</span>
                      <span className="block text-xs text-[#1B2632]/60">{t('par.declencheAssignAide')}</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer max-w-sm">
                    <input type="checkbox" checked={nouveauStatut.ferme_le_lead} onChange={(e) => setNouveauStatut({...nouveauStatut, ferme_le_lead: e.target.checked})} className="mt-0.5 w-4 h-4 accent-[#1B2632] cursor-pointer" />
                    <span>
                      <span className="block text-sm font-bold text-[#1B2632]">{t('par.termine')}</span>
                      <span className="block text-xs text-[#1B2632]/60">
                        {t("par.termineAide")}
                      </span>
                    </span>
                  </label>
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                <table className="fg-table w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th>{t('par.statut')}</th>
                      <th>{t('par.code')}</th>
                      <th>{t('par.pays')}</th>
                      <th>{t('par.badge')}</th>
                      <th className="text-center">{t('par.rappel')}</th>
                      <th className="text-center">{t('par.assignation')}</th>
                      <th className="text-right">{t('par.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargement ? (
                      <tr><td colSpan="7" className="text-center py-6">{t('par.chargement')}</td></tr>
                    ) : listeStatuts.length === 0 ? (
                      <tr><td colSpan="7" className="text-center py-6 text-gray-400">{t('par.aucunStatut')}</td></tr>
                    ) : (
                      listeStatuts.map((s) => (
                        <tr key={s.id} className="hover:bg-[#EEE9DF]/20">
                          {/* Le nom est la VALEUR enregistrée sur les commandes ; l'écran
                              affiche son libellé français (lib/libellesStatuts.mjs). */}
                          <td className="font-medium">
                            {s.nom}
                            {libelleStatut(s.nom) !== s.nom && (
                              <span className="block text-xs font-normal text-[#1B2632]/50">affiché « {libelleStatut(s.nom)} »</span>
                            )}
                          </td>
                          <td><span className="font-mono text-xs text-[#1B2632]/50">{s.code}</span></td>
                          <td>{s.pays?.nom ? <span className="fg-badge">{s.pays.nom}</span> : <span className="text-xs text-[#1B2632]/50">{t('par.tousPays')}</span>}</td>
                          {/* Badge lisible (20/11) : couleur au point et au fond, texte foncé. */}
                          <td>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold text-[#1B2632] whitespace-nowrap"
                              style={{ backgroundColor: `${s.couleur}26`, borderColor: `${s.couleur}66` }}>
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.couleur }} />
                              {libelleStatut(s.nom)}
                            </span>
                          </td>
                          <td className="text-center">{s.necessite_rappel ? <span className="text-[#FFB162] font-bold">●</span> : "—"}</td>
                          <td className="text-center">{s.declenche_assignation ? <span className="text-[#2C3B4D] font-bold">●</span> : "—"}</td>
                          <td className="text-right flex items-center justify-end gap-2">
                            <button onClick={() => preparerModificationStatut(s)} className="px-3 py-1 bg-white border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] hover:bg-gray-50 cursor-pointer">{t('par.modifier')}</button>
                            <button onClick={() => supprimerStatut(s.id)} className="fg-btn-danger">{t('par.supprimer')}</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- ONGLET PRODUITS --- */}
        {ongletActif === "entrepots" && peutGererEntrepots && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">{t('par.gestionEntrepots')}</h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">
                  {t("par.entrepotAide")}
                </p>
              </div>

              {peutGererEntrepots && (
              <>
              <form onSubmit={ajouterEntrepot} className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.pays')}</label>
                  {/* Les pays qui ont déjà un dépôt ne sont pas proposés : la base
                      les refuserait, autant ne pas les offrir. */}
                  <select value={nouvelEntrepot.pays_id} onChange={(e) => setNouvelEntrepot({...nouvelEntrepot, pays_id: e.target.value})} className="fg-input cursor-pointer" required>
                    <option value="">{t('par.choisir')}</option>
                    {listePays
                      .filter((p) => !listeEntrepots.some((en) => en.pays_id === p.id))
                      .map((p) => (<option key={p.id} value={p.id}>{p.nom}</option>))}
                  </select>
                </div>
                <div>
                  <button type="submit" className="fg-btn-primary w-full">{t('par.ajouterEntrepot')}</button>
                </div>
              </form>
              {listePays.length > 0 && listePays.every((p) => listeEntrepots.some((en) => en.pays_id === p.id)) && (
                <p className="text-xs text-[#1B2632]/50 -mt-6 mb-8">
                  {t("par.tousPaysEntrepot")}
                </p>
              )}
              </>
              )}

              <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                <table className="fg-table w-full min-w-[560px]">
                  <thead>
                    <tr><th>{t('par.entrepot')}</th><th>{t('par.pays')}</th><th className="text-center">{t('par.statut')}</th>{peutGererEntrepots && <th className="text-right">{t('par.actions')}</th>}</tr>
                  </thead>
                  <tbody>
                    {listeEntrepots.length === 0 && <tr><td colSpan={peutGererEntrepots ? 4 : 3} className="text-center py-6 text-gray-400">{t('par.aucunEntrepot')}</td></tr>}
                    {listeEntrepots.map((e) => (
                      <tr key={e.id} className="hover:bg-[#EEE9DF]/20">
                        <td className="font-bold text-[#1B2632]">{e.nom}</td>
                        <td>
                          {peutGererEntrepots ? (
                            <select value={e.pays_id || ""} onChange={(ev) => changerPaysEntrepot(e.id, ev.target.value)}
                              className={`fg-input cursor-pointer !py-1.5 !text-sm ${e.pays_id ? '' : 'border-[#A35139] text-[#A35139]'}`}>
                              <option value="">{t('par.nonRenseigne')}</option>
                              {listePays.map((p) => (<option key={p.id} value={p.id}>{p.nom}</option>))}
                            </select>
                          ) : (
                            <span className="text-gray-600">{listePays.find((p) => p.id === e.pays_id)?.nom || '-'}</span>
                          )}
                        </td>
                        <td className="text-center"><span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold text-[#1B2632] bg-[#2E7D53]/15 border-[#2E7D53]/40"><span className="w-2 h-2 rounded-full bg-[#2E7D53]" />{t('par.actif')}</span></td>
                        {peutGererEntrepots && (
                          <td className="text-right">
                            <button onClick={() => supprimerEntrepot(e)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#A35139]/40 bg-white text-[#A35139] hover:bg-[#A35139]/10 transition-colors cursor-pointer">
                              {t('par.supprimer')}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- ONGLET STOCKS & MOUVEMENTS (style harmonisé avec le reste de la page) --- */}
        {ongletActif === "stocks" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">{t('par.inventaire')}</h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">{t('par.inventaireAide')}</p>
              </div>

              {/* Même fond neutre en pointillés que tous les autres formulaires de la page */}
              <form onSubmit={ajouterMouvement} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.produit')}</label>
                  <select required value={nouveauMouvement.produit_id} onChange={(e) => setNouveauMouvement({...nouveauMouvement, produit_id: e.target.value})} className="fg-input cursor-pointer">
                    <option value="">{t('par.selectProduit')}</option>
                    {listeProduits.map((p) => (<option key={p.id} value={p.id}>{p.product} ({p.code})</option>))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.entrepotCible')}</label>
                  <select required value={nouveauMouvement.entrepot_id} onChange={(e) => setNouveauMouvement({...nouveauMouvement, entrepot_id: e.target.value})} className="fg-input cursor-pointer">
                    <option value="">{t('par.selectEntrepot')}</option>
                    {listeEntrepots.map((e) => (<option key={e.id} value={e.id}>{e.nom}</option>))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.natureOperation')}</label>
                  <select required value={nouveauMouvement.type_mouvement} onChange={(e) => setNouveauMouvement({...nouveauMouvement, type_mouvement: e.target.value})} className="fg-input cursor-pointer">
                    <option value="entree">{t('par.optEntree')}</option>
                    <option value="sortie">{t('par.optSortie')}</option>
                    <option value="retour_ok">{t('par.optRetourOk')}</option>
                    <option value="retour_defaut">{t('par.optRetourDefaut')}</option>
                    <option value="ajustement">{t('par.optAjustement')}</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.quantite')}</label>
                  <input type="number" min="1" required value={nouveauMouvement.quantite} onChange={(e) => setNouveauMouvement({...nouveauMouvement, quantite: e.target.value})} className="fg-input" />
                </div>

                {/* Bouton dans sa propre colonne, même hauteur (44px) et même couleur primaire que partout ailleurs */}
                <div className="flex gap-2">
                  <button type="submit" className="fg-btn-primary w-full">{t('par.validerMouvement')}</button>
                </div>
              </form>

              <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                <table className="fg-table w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th>{t('par.produit')}</th>
                      <th>{t('par.sku')}</th>
                      <th>{t('par.entrepot')}</th>
                      <th className="text-right">{t('par.disponible')}</th>
                      <th className="text-right">{t('par.defectueux')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listeStocks.length === 0 && <tr><td colSpan="5" className="text-center py-6 text-gray-400">{t('par.aucunStock')}</td></tr>}
                    {listeStocks.map((s) => (
                      <tr key={s.id} className="hover:bg-[#EEE9DF]/20">
                        <td className="font-bold text-[#1B2632]">{s.produits?.product}</td>
                        <td><span className="font-mono text-xs text-[#A35139] font-semibold">{s.produits?.code}</span></td>
                        <td className="font-medium text-gray-700">{s.entrepots?.nom}</td>
                        <td className="text-right font-bold text-[#1B2632]">{s.quantite_disponible}</td>
                        <td className="text-right font-semibold text-red-600">{s.quantite_defectueuse}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-10 mb-4">
                <h3 className="text-lg font-bold text-[#1B2632]">{t('par.historiqueMouvements')}</h3>
                <p className="text-sm text-[#1B2632]/60 mt-1">
                  Tous les produits de l&apos;entreprise, supprimés compris : un mouvement garde le nom du produit.
                  {listeMouvements.length >= MOUVEMENTS_AFFICHES && t("par.plusRecents", { n: MOUVEMENTS_AFFICHES })}
                </p>
              </div>
              <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                <table className="fg-table w-full min-w-[720px]">
                  <thead>
                    <tr>
                      <th>{t('par.date')}</th>
                      <th>{t('par.produit')}</th>
                      <th>{t('par.sku')}</th>
                      <th>{t('par.entrepot')}</th>
                      <th>{t('par.type')}</th>
                      <th className="text-right">{t('par.quantite')}</th>
                      <th>{t('par.raison')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listeMouvements.length === 0 && <tr><td colSpan="7" className="text-center py-6 text-gray-400">{t('par.aucunMouvement')}</td></tr>}
                    {listeMouvements.map((m) => {
                      // Tant que le produit existe, son nom actuel ; supprimé,
                      // le nom écrit sur le mouvement.
                      const supprime = !m.produits;
                      return (
                        <tr key={m.id} className="hover:bg-[#EEE9DF]/20">
                          <td className="whitespace-nowrap text-sm text-gray-700">{m.created_at ? new Date(m.created_at).toLocaleString(locale) : "—"}</td>
                          <td className="font-bold text-[#1B2632]">
                            {(supprime ? m.produit_nom : m.produits.product) || "—"}
                            {supprime && <span className="ml-2 text-[11px] font-semibold text-[#A35139]">{t('par.produitSupprime')}</span>}
                          </td>
                          <td><span className="font-mono text-xs text-[#A35139] font-semibold">{(supprime ? m.produit_code : m.produits.code) || ""}</span></td>
                          <td className="font-medium text-gray-700">{m.entrepots?.nom || "—"}</td>
                          <td className="text-sm text-gray-700">{LIBELLE_MOUVEMENT[m.type_mouvement] ? t("par.mouv." + m.type_mouvement) : m.type_mouvement}</td>
                          <td className="text-right font-bold text-[#1B2632]">{m.quantite}</td>
                          {/* Commande supprimée depuis : les 8 premiers caractères de son id. */}
                          <td className="text-sm text-gray-600">{String(m.notes || "").replace(UUID_G, (u) => refsCommandes[u] || u.slice(0, 8))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- ONGLET FRAIS VENDEURS (frais_vendeurs.sql) --- */}
        {ongletActif === "frais" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
              <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">{t('par.fraisVendeurs')}</h2>
                <p className="text-sm text-[#1B2632]/60 mt-1">
                  {t("par.fraisAide")}
                </p>
              </div>

              {peutModifierFrais ? (
                <form onSubmit={ajouterTarif} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end mb-8 p-6 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.pays')}</label>
                    <select required value={nouveauTarif.pays_id} onChange={(e) => setNouveauTarif({ ...nouveauTarif, pays_id: e.target.value })} className="fg-input cursor-pointer">
                      <option value="">{t('par.choisirCourt')}</option>
                      {listePays.map((p) => (<option key={p.id} value={p.id}>{p.nom}</option>))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.vendeur')}</label>
                    <select value={nouveauTarif.vendeur_id} onChange={(e) => setNouveauTarif({ ...nouveauTarif, vendeur_id: e.target.value })} className="fg-input cursor-pointer">
                      <option value="">{t('par.tousVendeurs')}</option>
                      {listeVendeurs.map((v) => (<option key={v.user_id} value={v.user_id}>{v.nom || v.email}</option>))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.fraisCommande')}</label>
                    <input type="number" min="0" step="any" required value={nouveauTarif.frais_commande} onChange={(e) => setNouveauTarif({ ...nouveauTarif, frais_commande: e.target.value })} className="fg-input" placeholder="1000" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.fraisLivraison')}</label>
                    <input type="number" min="0" step="any" required value={nouveauTarif.frais_livraison} onChange={(e) => setNouveauTarif({ ...nouveauTarif, frais_livraison: e.target.value })} className="fg-input" placeholder="12000" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.upsellUnite')}</label>
                    <input type="number" min="0" step="any" required value={nouveauTarif.frais_upsell_unite} onChange={(e) => setNouveauTarif({ ...nouveauTarif, frais_upsell_unite: e.target.value })} className="fg-input" placeholder="1500" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.fraisTransfert')}</label>
                    <input type="number" min="0" max="100" step="any" value={nouveauTarif.frais_transfert_pct} onChange={(e) => setNouveauTarif({ ...nouveauTarif, frais_transfert_pct: e.target.value })} className="fg-input" placeholder="0" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('par.valideDepuis')}</label>
                    <input type="date" value={nouveauTarif.valide_depuis} onChange={(e) => setNouveauTarif({ ...nouveauTarif, valide_depuis: e.target.value })} className="fg-input" />
                  </div>
                  <button type="submit" className="fg-btn-primary w-full">{t('par.ajouter')}</button>
                </form>
              ) : (
                <p className="text-xs text-[#1B2632]/50 mb-6">{t('par.seulAdmin')}</p>
              )}
              {peutModifierFrais && (
                <p className="text-xs text-[#1B2632]/50 -mt-6 mb-8">{t('par.dateVideAide')}</p>
              )}

              <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                <table className="fg-table w-full min-w-[860px]">
                  <thead>
                    <tr>
                      <th>{t('par.pays')}</th><th>{t('par.vendeur')}</th>
                      <th className="text-right">{t('par.fraisCommande')}</th><th className="text-right">{t('par.fraisLivraison')}</th>
                      <th className="text-right">{t('par.upsellUniteCourt')}</th><th className="text-right">{t('par.transfert')}</th><th>{t('par.valideDepuis')}</th>
                      {peutModifierFrais && <th className="text-right">{t('par.actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {listeTarifs.length === 0 && (
                      <tr><td colSpan={peutModifierFrais ? 8 : 7} className="text-center py-6 text-gray-400">
                        {t('par.aucunFrais')}
                      </td></tr>
                    )}
                    {listeTarifs.map((tarif) => {
                      const devise = tarif.pays?.devise || "";
                      const m = (x) => `${Number(x || 0).toLocaleString(locale)} ${devise}`;
                      return (
                        <tr key={tarif.id} className="hover:bg-[#EEE9DF]/20">
                          <td className="font-bold text-[#1B2632]">{tarif.pays?.nom || "-"}</td>
                          <td>{nomVendeurTarif(tarif.vendeur_id)}</td>
                          <td className="text-right font-mono">{m(tarif.frais_commande)}</td>
                          <td className="text-right font-mono">{m(tarif.frais_livraison)}</td>
                          <td className="text-right font-mono">{m(tarif.frais_upsell_unite)}</td>
                          <td className="text-right font-mono">{Number(tarif.frais_transfert_pct || 0).toLocaleString(locale)} %</td>
                          <td>{new Date(tarif.valide_depuis + "T00:00:00").toLocaleDateString(locale)}</td>
                          {peutModifierFrais && (
                            <td className="text-right">
                              <button onClick={() => supprimerTarif(tarif.id)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#A35139]/40 bg-white text-[#A35139] hover:bg-[#A35139]/10 transition-colors cursor-pointer">
                                {t('par.supprimer')}
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        </fieldset>
      </main>
    </div>
  );
}

function StyleParametres() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

      .fg-input{width:100%;padding:10px 14px;border-radius:10px;border:1px solid var(--oatmeal);font-family:'Inter';font-size:14px;outline:none;background:#fff;transition:0.2s;}
      .fg-input:focus{border-color:#1B2632;box-shadow:0 0 0 2px rgba(27,38,50,0.05);}

      .fg-btn-primary{background:#1B2632;color:#fff;border:none;padding:10px 20px;border-radius:10px;font-weight:600;cursor:pointer;transition:0.2s;white-space:nowrap;height:44px;}
      .fg-btn-primary:hover{background:#2C3B4D;}

      .fg-btn-danger{background:transparent;color:#A35139;border:1px solid rgba(163,81,57,0.3);padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;}
      .fg-btn-danger:hover{background:rgba(163,81,57,0.1);}

      .fg-table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;}
      .fg-table th{background:#EEE9DF30;padding:14px 20px;font-size:11px;font-weight:700;color:#1B263290;border-bottom:1px solid #C9C1B1;}
      .fg-table td{padding:14px 20px;border-bottom:1px solid #C9C1B150;color:#1B2632;}
      .fg-table tr:last-child td{border-bottom:none;}

      .fg-badge{display:inline-block;padding:4px 8px;border-radius:6px;background:#EEE9DF;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;}
      .fg-badge.dark{background:#1B2632;color:#fff;}

      .tab-scroll::-webkit-scrollbar{height:6px;}
      .tab-scroll::-webkit-scrollbar-track{background:transparent;}
      .tab-scroll::-webkit-scrollbar-thumb{background:#C9C1B1;border-radius:99px;}
      .tab-scroll::-webkit-scrollbar-thumb:hover{background:#A35139;}
    `}</style>
  );
}