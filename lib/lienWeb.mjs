// Le lien de vérification d'un produit (16/11/2026, revue de sécurité du
// 13/11, point 4) : seulement une vraie adresse web, http:// ou https://.
//
// Le champ du formulaire est en type="url" : le navigateur accepte toute
// adresse qui en a l'air — « httpps://… » (VORALIS DIABETICA, 10/11) ou
// « javascript:… », qui exécuterait du code au clic. React 19 refuse déjà
// javascript: à l'affichage ; ici, notre propre règle, à l'enregistrement et
// à l'affichage.

export function estLienWeb(texte) {
  const valeur = String(texte ?? '').trim()
  if (!valeur) return false
  let url
  try {
    url = new URL(valeur)
  } catch {
    return false
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
}
