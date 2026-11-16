// Une cellule d'export CSV (16/11/2026, revue de sécurité du 13/11, point 2).
//
// Excel / LibreOffice lisent comme une FORMULE toute cellule qui commence par
// = + - @ (ou tabulation / retour chariot). Un nom de client venu de la
// boutique, de l'API ou d'un Google Sheet comme =HYPERLINK("http://…?d="&B2;"…")
// devenait un lien actif dans l'export, qui envoie les cellules voisines.
// Ces cellules reçoivent une apostrophe devant : Excel les montre comme texte.
//
// Exception : un nombre ou un téléphone seul (« +244 923 456 789 », « -500 »,
// « +5 ») reste tel quel — ce n'est pas une formule dangereuse, et sinon
// chaque téléphone de l'export aurait une apostrophe.
//
// Toujours entre guillemets, les " doublés : une virgule ou un saut de ligne
// dans la valeur ne décale plus les colonnes (Lead ID / Source de Commandes
// n'étaient pas entre guillemets avant le 16/11).

const DEBUT_FORMULE = /^[=+\-@\t\r]/
const NOMBRE_SEUL = /^[+-]?[\d\s.,()]+$/

export function celluleCSV(valeur) {
  let texte = String(valeur ?? '')
  if (DEBUT_FORMULE.test(texte) && !NOMBRE_SEUL.test(texte)) texte = "'" + texte
  return '"' + texte.replace(/"/g, '""') + '"'
}

// Lignes (tableaux de valeurs) → contenu CSV, une ligne par tableau.
export function contenuCSV(lignes) {
  return lignes.map((l) => l.map(celluleCSV).join(',')).join('\n')
}
