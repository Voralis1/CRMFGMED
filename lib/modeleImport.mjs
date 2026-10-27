// Le modèle d'import des commandes : les colonnes, ce qu'il faut savoir pour
// les remplir, et la ligne d'exemple. UNE copie, lue par l'import CSV de
// l'écran Commandes ET par la feuille Google de « Mon API » (le format montré
// au vendeur et le code Apps Script généré). Sans import, comme champs.ts.
//
// `requisFeuille` : obligatoire pour qu'une ligne de feuille Google parte.
// Plus large que `requis` (ce que l'aperçu CSV exige) : l'API remplit seule un
// montant absent (0) et une quantité absente (1). Une ligne envoyée avant son
// montant entrerait à 0, et le montant tapé ensuite répondrait « déjà
// importé » — perdu sans que personne le voie. L'adresse (écrite par l'agent)
// et la boutique restent facultatives.
//
// LES NOMS (27/10) : le français est ce qu'on MONTRE et ce qu'on GÉNÈRE
// (modèle, « À lire », aide à l'écran, aperçu, Mon API, code Apps Script,
// API_COMMANDES.md). L'anglais de l'ancien modèle (Order ID, Product,
// Customer, Phone number, City, Address, Quantities, Store) reste ACCEPTÉ,
// sans rien dire, comme le portugais : ce sont des noms de champs.ts. Les
// fichiers et les feuilles Google déjà faites continuent de marcher sans
// qu'on y touche. tests/test_import_generique.mjs vérifie que chaque nom
// montré ici ET chaque ancien nom anglais est dans champs.ts.

// Les colonnes qu'on sait lire dans un fichier d'import, et sous quels noms.
// Une seule liste : elle sert à lire le fichier ET à montrer à l'écran quelle
// en-tête a été reconnue. Deux listes auraient fini par diverger, et l'aperçu
// aurait menti.
//
// Les NOMS acceptés viennent de supabase/functions/_shared/champs.ts — la
// même table que l'API (import-commande) : « Cidade » passe par les deux ou
// par aucun. `champ` dit quelle liste de cette table.
// `mots` : un repli propre au tableur, pour les en-têtes qu'on n'a pas
// prévues — « Unit Price (USD) » contient « price ». L'API ne l'a pas (voir
// champs.ts : dans un JSON, « shipping_total » contient « total »).
// `aussi` : les noms montrés au vendeur quand une colonne obligatoire manque.
export const CHAMPS_IMPORT = [
  { cle: 'order_id',  nom: 'N° de commande', champ: 'lead_id',          mots: ['order_id', 'lead_id'], requisFeuille: true },
  { cle: 'produit',   nom: 'Produit',        champ: 'produit',          mots: ['produit', 'product', 'produto', 'article'], requisFeuille: true },
  { cle: 'client',    nom: 'Client',         champ: 'client_nom',       mots: ['customer', 'client', 'nom', 'name'], requisFeuille: true },
  { cle: 'telephone', nom: 'Téléphone',      champ: 'client_telephone', mots: ['phone', 'telephone', 'telefone', 'tel', 'numero'], requis: true, aussi: 'Téléphone, Tel, Phone, Phone number, Telefone, Telemóvel, Celular', requisFeuille: true },
  // Pas de colonne pays : le pays est celui de l'entrepôt (ou du pays)
  // choisi à l'écran. Celui qui importe sait d'où partent ses leads ; un
  // pays par ligne n'était qu'une chose de plus à mal écrire.
  { cle: 'ville',     nom: 'Ville',          champ: 'ville_zone',       mots: ['city', 'ville', 'cidade', 'localidade', 'town'], requis: true, aussi: 'Ville, City, Cidade, Localidade, Town, Município', requisFeuille: true },
  // L'adresse s'écrit pendant l'appel, par l'agent. Prise si le fichier l'a.
  { cle: 'adresse',   nom: 'Adresse',        champ: 'adresse',          mots: ['address', 'adresse', 'endereco', 'morada'], note: 'remplie par l\u2019agent' },
  { cle: 'quantite',  nom: 'Quantité',       champ: 'quantite',         mots: ['quantit', 'quantidade', 'qty', 'qte', 'qtd', 'nombre'], requisFeuille: true },
  // Le montant de TOUTE la commande, celui que le livreur encaisse. Jamais
  // multiplié par la quantité. L'ancien en-tête « Unit price » du modèle est
  // encore lu (mot « price ») : les vendeurs y écrivaient déjà le total
  // (vérifié le 21/10 : 1 = 35 000, 2 = 45 000, 3 = 58 000).
  { cle: 'prix',      nom: 'Montant à encaisser', champ: 'prix',      mots: ['encaisser', 'price', 'prix', 'preco', 'montant', 'valor'], requisFeuille: true },
  { cle: 'store',     nom: 'Boutique',       champ: 'source_sheet',     mots: ['store', 'boutique', 'loja'] },
  // Pas de colonne « Notes » : un texte libre que personne ne relit n'aide ni
  // l'agent ni le livreur. Les consignes réelles passent par l'appel.
]

// Ce qu'il faut savoir pour remplir le fichier — UNE liste, rendue deux
// fois : dans l'aide à l'écran et dans la feuille « À lire » du modèle.
export const CONSIGNES_IMPORT = [
  { titre: 'N° de commande', texte: 'Votre numéro de commande, gardé tel quel : c\u2019est celui que vous citerez au téléphone. Sans cette colonne, un numéro est généré.' },
  { titre: 'Téléphone', texte: 'Obligatoire. Plusieurs numéros séparés par | : le premier est appelé, les autres sont notés sur la commande.' },
  { titre: 'Ville', texte: 'Obligatoire. La ville du client (Ville, City, Cidade, Localidade, Town sont reconnus).' },
  { titre: 'Adresse', texte: 'Laissez vide si vous ne la connaissez pas : l\u2019agent l\u2019écrit pendant l\u2019appel.' },
  { titre: 'Produit', texte: 'Le code du produit au catalogue, un seul produit par ligne. Un produit absent du catalogue bloque l\u2019import : l\u2019aperçu le nomme et dit quoi faire. Un produit en rupture de stock entre quand même — l\u2019aperçu le signale.' },
  { titre: 'Montant à encaisser', texte: 'Le montant de TOUTE la commande, celui que le livreur encaisse, enregistré tel quel. Jamais multiplié par la quantité : 3 unités à 58 000 s\u2019écrivent 58000.' },
]

// La ligne d'exemple, la même dans l'aide à l'écran et dans « À lire ».
// JAMAIS dans la feuille de données : une ligne oubliée devenait un faux lead
// dans la file d'appel, et un numéro plausible, un agent finit par l'appeler.
// D'où des valeurs que personne ne peut prendre pour une vraie commande.
// Un seul produit, la ville et la boutique remplies, l'adresse VIDE (c'est
// l'agent qui l'écrit), le montant de toute la commande.
export const EXEMPLE_IMPORT = {
  'N° de commande': 'NUMERO_COMMANDE',
  'Produit': 'CODE_PRODUIT',
  'Client': 'NOM_DU_CLIENT',
  'Téléphone': '+244 000 000 000',
  'Ville': 'VILLE_DU_CLIENT',
  'Adresse': '',
  'Quantité': '1',
  'Montant à encaisser': '35000',
  'Boutique': 'NOM_DE_LA_BOUTIQUE',
}

// Le nom montré d'une colonne, par sa clé : nomColonne('telephone') →
// « Téléphone ». Pour les textes qui citent une colonne (Mon API, le code
// Apps Script) : jamais un nom recopié à la main.
export const nomColonne = (cle) => CHAMPS_IMPORT.find((c) => c.cle === cle)?.nom ?? cle

// Les en-têtes de l'ancien modèle (jusqu'au 27/10), toujours acceptées.
// Pas montrées : gardées ici pour que les tests prouvent qu'elles passent.
export const ANCIENNES_ENTETES = ['Order ID', 'Product', 'Customer', 'Phone number', 'City', 'Address', 'Quantities', 'Montant à encaisser', 'Store']
