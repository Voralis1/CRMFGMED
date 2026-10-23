// Le code Apps Script qu'un vendeur colle dans SA feuille Google (« Mon API »
// → Google Sheets). C'est la feuille qui POUSSE vers import-commande ; rien
// ne lit la feuille de notre côté.
//
// Généré ici, pas écrit à la main dans la page, pour deux raisons :
//   · les colonnes et leurs noms viennent des MÊMES listes que l'import CSV
//     (modeleImport.mjs) et que l'API (champs.ts) — une colonne reconnue
//     par l'un l'est par les autres ;
//   · le code se teste hors de Google (supabase/tests/test_script_google_sheets.mjs),
//     avec une fausse feuille et un faux CRM.
//
// Les choix (décidés le 23/10) :
//   · clé et secret en EN-TÊTES (x-import-token, x-api-secret), jamais dans
//     l'URL : une adresse finit dans des journaux ;
//   · une ligne ne part que COMPLÈTE (colonnes `requisFeuille`) : envoyée à
//     moitié tapée, elle entrerait incomplète et chaque correction répondrait
//     « déjà importé » ;
//   · Order ID obligatoire, envoyé « GS-<Order ID> » : sans lui la clé de
//     doublon est devinée (téléphone + produit + jour), et le préfixe évite
//     qu'une commande WooCommerce n°727 de la même source prenne la place de
//     la ligne 727 de la feuille ;
//   · deux déclencheurs, posés par la fonction `installer` : « modification »
//     (une saisie, un collage) et « envoi de formulaire » (un Google Form
//     relié à la feuille — une modification ne se déclenche PAS pour une
//     réponse de formulaire) ;
//   · toutes les lignes de la plage modifiée, 50 au plus, en un seul appel ;
//   · 429 : on attend Retry-After (30 s au plus) et on réessaie une fois ;
//   · colonne facultative « Statut CRM » : la réponse du CRM, ligne par ligne.
import { CHAMPS_IMPORT } from './modeleImport.mjs'
import { NOMS, cleNormalisee } from '../supabase/functions/_shared/champs.ts'

export const COLONNE_STATUT = 'Statut CRM'
export const PREFIXE_SHEETS = 'GS-'
export const MAX_LIGNES_SHEETS = 50
export const ETIQUETTE_SHEETS = 'google-sheet'
// Ce qui reste dans le code tant que le secret n'a pas été révélé. `installer`
// refuse de tourner avec : un code collé sans secret échoue tout de suite, en
// clair, au lieu de n'envoyer rien.
export const SECRET_A_REMPLIR = 'COLLEZ_ICI_LE_SECRET_API'

// Les colonnes, dans l'ordre du modèle : le nom montré, les noms acceptés
// (ceux de champs.ts, plus le nom du modèle lui-même), et si elle est
// obligatoire pour la feuille.
export function colonnesSheets() {
  return CHAMPS_IMPORT.map((c) => ({
    champ: c.champ,
    nom: c.nom,
    noms: [...new Set([cleNormalisee(c.nom), ...NOMS[c.champ]])],
    obligatoire: !!c.requisFeuille,
  }))
}

export function genererScriptSheets({ urlFonction, cle, secret, nomSource, date = new Date() }) {
  const jour = date.toLocaleDateString('fr-FR')
  const url = `${urlFonction}?source=${ETIQUETTE_SHEETS}`
  const colonnes = colonnesSheets()
  const j = (v) => JSON.stringify(v)

  return `// =====================================================================
// CRM FGMED — les commandes de cette feuille, envoyées au centre d'appel
// Source : « ${String(nomSource || '').replace(/[\r\n]/g, ' ')} » — code généré le ${jour} depuis « Mon API ».
//
// Ne modifiez rien dans ce fichier. Pour l'installer, une seule fois :
// choisissez « installer » dans la liste en haut, puis « Exécuter ».
// =====================================================================

// Ce script ne demande accès qu'à CETTE feuille, pas à vos autres fichiers.
/** @OnlyCurrentDoc */

// Vos identifiants. ATTENTION : toute personne qui peut MODIFIER cette
// feuille peut lire ce code, donc ce secret. Ne partagez la feuille qu'avec
// les personnes qui envoient des commandes. En cas de fuite : « Régénérer les
// identifiants » dans Mon API, puis générez et collez un nouveau code.
var URL_CRM = ${j(url)};
var CLE_API = ${j(cle || '')};
var SECRET_API = ${j(secret || SECRET_A_REMPLIR)};

// Les colonnes lues en ligne 1, et les noms acceptés pour chacune (comparés
// sans accents ni majuscules). Les mêmes que le modèle d'import du CRM.
var COLONNES = ${j(colonnes)};
var NOMS_STATUT = ${j([cleNormalisee(COLONNE_STATUT)])};
// La colonne qu'un Google Form ajoute en premier (la date de la réponse).
var NOMS_HORODATEUR = ["horodateur", "horodatage", "timestamp", "carimbo_de_data_hora", "marca_temporal"];
var PREFIXE_COMMANDE = ${j(PREFIXE_SHEETS)};
var MAX_LIGNES = ${MAX_LIGNES_SHEETS};

// Pas de suivi des lignes déjà envoyées, et c'est voulu. Le CRM reconnaît
// une commande déjà reçue à son Order ID et répond « déjà importé » sans
// rien créer : renvoyer une ligne ne coûte rien. N'ajoutez ni colonne
// « envoyé » ni mémoire des lignes : elles ne serviraient à rien.

// ---------------------------------------------------------------------
// À lancer UNE fois, à la main : vérifie vos identifiants et la feuille,
// puis pose les deux déclencheurs. Le relancer ne crée pas de doublon.
// ---------------------------------------------------------------------
function installer() {
  if (SECRET_API === ${j(SECRET_A_REMPLIR)}) {
    throw new Error("Le secret API manque dans ce code. Dans Mon API, cliquez « Révéler le secret », recopiez TOUT le code et collez-le à la place de celui-ci.");
  }
  // Un « ping » : le CRM vérifie la clé et le secret, et n'enregistre rien.
  var test = appeler_("webhook_id=0", "text/plain");
  if (test.code === 401) {
    throw new Error("Le CRM refuse la clé ou le secret API (ont-ils été régénérés ?). Générez un nouveau code dans Mon API et collez-le.");
  }
  if (test.code !== 200) {
    throw new Error("Le CRM ne répond pas comme prévu (code " + test.code + "). Réessayez dans une minute.");
  }

  var classeur = SpreadsheetApp.getActive();
  var onglets = classeur.getSheets().filter(function (f) {
    return lireColonnes_(f).champs.client_telephone !== undefined;
  });
  if (!onglets.length) {
    throw new Error("Aucun onglet n'a de colonne « Phone number » en ligne 1. Mettez les en-têtes du modèle en ligne 1, puis relancez « installer ».");
  }

  // Retirés puis recréés : installer deux fois n'enverrait pas deux fois.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "envoyerAuCRM") ScriptApp.deleteTrigger(t);
  });
  // « Modification » : une saisie ou un collage dans la feuille.
  ScriptApp.newTrigger("envoyerAuCRM").forSpreadsheet(classeur).onEdit().create();
  // « Envoi de formulaire » : une réponse d'un Google Form relié à la feuille.
  // Une réponse de formulaire ne déclenche PAS « modification » : sans ce
  // deuxième déclencheur, ces lignes ne partiraient jamais.
  ScriptApp.newTrigger("envoyerAuCRM").forSpreadsheet(classeur).onFormSubmit().create();

  onglets.forEach(function (f) {
    var c = lireColonnes_(f);
    var absentes = COLONNES.filter(function (col) {
      return col.obligatoire && c.champs[col.champ] === undefined && !(col.champ === "lead_id" && c.horodateur !== undefined);
    }).map(function (col) { return col.nom; });
    console.log("Onglet « " + f.getName() + " » : " +
      (absentes.length ? "COLONNES ABSENTES : " + absentes.join(", ") + " — aucune ligne ne partira sans elles." : "toutes les colonnes obligatoires sont là.") +
      " Colonne « Statut CRM » : " + (c.statut !== undefined ? "oui." : "non (facultative, recommandée)."));
  });
  console.log("Installation terminée. Chaque ligne complète part dès qu'elle est saisie.");
}

// ---------------------------------------------------------------------
// Lancée par les déclencheurs, jamais à la main.
// ---------------------------------------------------------------------
function envoyerAuCRM(e) {
  if (!e || !e.range) {
    console.log("Cette fonction part toute seule à chaque modification. Pour installer, exécutez « installer ».");
    return;
  }
  var feuille = e.range.getSheet();
  var colonnes = lireColonnes_(feuille);
  // Un onglet sans colonne téléphone n'est pas un onglet de commandes.
  if (colonnes.champs.client_telephone === undefined) return;

  var premiere = Math.max(2, e.range.getRow()); // la ligne 1, ce sont les en-têtes
  var derniere = e.range.getLastRow();
  if (derniere < premiere) return;
  var fin = Math.min(derniere, premiere + MAX_LIGNES - 1);

  // Deux modifications rapprochées : l'une attend l'autre.
  var verrou = LockService.getDocumentLock();
  if (!verrou.tryLock(30000)) {
    statutPlage_(feuille, colonnes, premiere, derniere, "non envoyé : feuille occupée, retouchez une case de la ligne");
    return;
  }
  try {
    if (derniere > fin) {
      statutPlage_(feuille, colonnes, fin + 1, derniere, "non envoyé : plus de " + MAX_LIGNES + " lignes à la fois, retouchez une case de la ligne");
    }
    var largeur = feuille.getLastColumn();
    var plage = feuille.getRange(premiere, 1, fin - premiere + 1, largeur);
    var brutes = plage.getValues();
    var affichees = plage.getDisplayValues();
    var envoi = [];
    for (var i = 0; i < brutes.length; i++) {
      var ligne = premiere + i;
      var lu = lireLigne_(brutes[i], affichees[i], colonnes);
      if (lu.vide) {
        ecrireStatut_(feuille, colonnes, ligne, "");
        continue;
      }
      if (lu.idCree) feuille.getRange(ligne, colonnes.champs.lead_id + 1).setValue(lu.idCree);
      if (lu.manque.length) {
        ecrireStatut_(feuille, colonnes, ligne, "en attente : il manque " + lu.manque.join(", "));
        continue;
      }
      envoi.push({ ligne: ligne, lead: lu.lead });
    }
    if (!envoi.length) return;

    var reponse = envoyer_(envoi.map(function (x) { return x.lead; }));
    envoi.forEach(function (x, n) { ecrireStatut_(feuille, colonnes, x.ligne, statut_(reponse, n)); });
  } finally {
    verrou.releaseLock();
  }
}

// --- lire la feuille -----------------------------------------------------

function normaliser_(texte) {
  return String(texte).normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Quelle colonne (index à partir de 0) pour chaque champ.
function lireColonnes_(feuille) {
  var resultat = { champs: {}, statut: undefined, horodateur: undefined };
  var largeur = feuille.getLastColumn();
  if (largeur < 1) return resultat;
  var entetes = feuille.getRange(1, 1, 1, largeur).getDisplayValues()[0].map(normaliser_);
  COLONNES.forEach(function (col) {
    for (var k = 0; k < col.noms.length; k++) {
      var idx = entetes.indexOf(col.noms[k]);
      if (idx !== -1) { resultat.champs[col.champ] = idx; return; }
    }
  });
  entetes.forEach(function (e, idx) {
    if (resultat.statut === undefined && NOMS_STATUT.indexOf(e) !== -1) resultat.statut = idx;
    if (resultat.horodateur === undefined && NOMS_HORODATEUR.indexOf(e) !== -1) resultat.horodateur = idx;
  });
  return resultat;
}

// Une cellule telle qu'il faut l'envoyer. Un nombre reste un nombre pour le
// montant et la quantité (« 35,000 » affiché serait lu 35) ; pour le reste,
// un nombre entier s'écrit sans exposant (un téléphone 244923111001).
function valeur_(brute, affichee, champ) {
  if (brute === null || brute === undefined || brute === "") return "";
  if (typeof brute === "number") {
    if (champ === "prix" || champ === "quantite") return brute;
    return Number.isInteger(brute) ? brute.toFixed(0) : String(brute);
  }
  if (brute instanceof Date) return String(affichee).trim();
  return String(brute).trim();
}

function lireLigne_(brutes, affichees, colonnes) {
  var lead = {}, manque = [], vide = true, idCree = null;
  COLONNES.forEach(function (col) {
    var idx = colonnes.champs[col.champ];
    var v = idx === undefined ? "" : valeur_(brutes[idx], affichees[idx], col.champ);
    if (v !== "") { lead[col.champ] = v; vide = false; }
  });
  if (vide) return { vide: true };

  // Une réponse de Google Form n'a pas d'Order ID : on en fait un avec la
  // date de la réponse et la fin du téléphone. Toujours le même pour la même
  // ligne, donc un renvoi répond « déjà importé ». Écrit dans la colonne
  // Order ID si elle existe, pour que vous puissiez le citer.
  if (lead.lead_id === undefined && colonnes.horodateur !== undefined) {
    var date = brutes[colonnes.horodateur];
    if (date instanceof Date) {
      var fin = String(lead.client_telephone || "").replace(/\\D/g, "").slice(-4);
      lead.lead_id = "F" + Utilities.formatDate(date, "UTC", "yyyyMMddHHmmss") + (fin ? "-" + fin : "");
      if (colonnes.champs.lead_id !== undefined) idCree = lead.lead_id;
    }
  }

  COLONNES.forEach(function (col) {
    if (!col.obligatoire || lead[col.champ] !== undefined) return;
    manque.push(colonnes.champs[col.champ] === undefined ? col.nom + " (colonne absente)" : col.nom);
  });
  if (lead.lead_id !== undefined && String(lead.lead_id).toUpperCase().indexOf(PREFIXE_COMMANDE) !== 0) {
    lead.lead_id = PREFIXE_COMMANDE + lead.lead_id;
  }
  return { vide: false, lead: lead, manque: manque, idCree: idCree };
}

// --- parler au CRM -------------------------------------------------------

function appeler_(corps, type) {
  try {
    var r = UrlFetchApp.fetch(URL_CRM, {
      method: "post",
      contentType: type,
      payload: corps,
      headers: { "x-import-token": CLE_API, "x-api-secret": SECRET_API },
      muteHttpExceptions: true,
    });
    var json = null;
    try { json = JSON.parse(r.getContentText()); } catch (x) { json = null; }
    var entetes = r.getHeaders() || {};
    var attente = Number(entetes["Retry-After"] || entetes["retry-after"] || 0);
    return { code: r.getResponseCode(), json: json, attente: attente };
  } catch (err) {
    return { code: 0, json: null, attente: 0 };
  }
}

// Toutes les lignes en un appel. Notre quota est de 60 appels par minute :
// une feuille modifiée par rafales peut l'atteindre. Alors on attend ce que
// le CRM demande (30 s au plus) et on réessaie UNE fois.
function envoyer_(leads) {
  var corps = JSON.stringify({ leads: leads });
  var r = appeler_(corps, "application/json");
  if (r.code === 429) {
    Utilities.sleep(Math.min(Math.max(r.attente || 5, 1), 30) * 1000);
    r = appeler_(corps, "application/json");
  }
  return r;
}

// « Téléphone manquant » → « téléphone manquant » ; « JSON illisible » reste tel quel.
function minuscule_(texte) {
  var t = String(texte || "motif inconnu");
  if (t.charAt(1) && t.charAt(1) !== t.charAt(1).toLowerCase()) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

// La réponse du CRM, en clair, pour la ligne n de l'envoi.
function statut_(r, n) {
  if (r.code === 200 && r.json && r.json.resultats && r.json.resultats[n]) {
    var res = r.json.resultats[n];
    if (res.status === "importe") return "importé";
    if (res.status === "doublon") return "déjà importé";
    return "refusé : " + minuscule_(res.error);
  }
  if (r.code === 401) return "refusé : clé ou secret API refusés (régénérés ?)";
  if (r.code === 429) return "trop de requêtes, réessayez";
  if (r.code === 400) return "refusé : " + minuscule_(r.json && r.json.error);
  if (r.code === 0) return "erreur réseau, réessayez";
  return "erreur du CRM (code " + r.code + "), réessayez";
}

// --- la colonne « Statut CRM », si elle existe ---------------------------
// Sans elle, rien n'est écrit et tout le reste marche. Ce que le script écrit
// ne relance pas le script : Google ne déclenche « modification » que pour
// une saisie humaine.

function ecrireStatut_(feuille, colonnes, ligne, texte) {
  if (colonnes.statut === undefined) return;
  var cellule = feuille.getRange(ligne, colonnes.statut + 1);
  if (texte === "" && cellule.getValue() === "") return;
  cellule.setValue(texte);
}

function statutPlage_(feuille, colonnes, debut, fin, texte) {
  for (var l = debut; l <= fin; l++) ecrireStatut_(feuille, colonnes, l, texte);
}
`
}
