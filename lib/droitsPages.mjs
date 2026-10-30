// Qui peut OUVRIR quelle page — vérifié par AppLayout AVANT de monter la page
// (30/10). Avant, chaque page lisait ses données dès la connexion et vérifiait
// la permission dans une redirection à part : la lecture partait, la
// redirection venait après, et les données étaient déjà dans le navigateur
// (un livreur qui tapait /paiements recevait la liste de tous les livreurs).
// Maintenant une page sans droit n'est jamais montée : aucun de ses effets ne
// tourne.
//
// Ces règles reprennent EXACTEMENT la redirection de chaque page (une page
// qui en change doit changer ici aussi). Les pages gardent la leur.
// `permissions` : une seule suffit. `superAdmin` : le rôle super_admin passe
// même sans la permission (comme le Dashboard le faisait).

export const REGLES_PAGES = [
  { prefixe: '/dashboard', permissions: ['menu_dashboard'], superAdmin: true },
  { prefixe: '/performances', permissions: ['menu_performances'] },
  { prefixe: '/commandes', permissions: ['menu_commandes', 'menu_dashboard'] },
  { prefixe: '/centre-appel', permissions: ['menu_centre_appel'] },
  { prefixe: '/assignation-livreur', permissions: ['menu_assignation_livreur'] },
  { prefixe: '/livraisons', permissions: ['menu_livraisons'] },
  { prefixe: '/paiements', permissions: ['menu_paiements'] },
  { prefixe: '/produits', permissions: ['menu_produits'] },
  { prefixe: '/expeditions', permissions: ['menu_expeditions'] },
  { prefixe: '/sources-import', permissions: ['menu_sources_import'] },
  { prefixe: '/utilisateurs', permissions: ['menu_utilisateurs'] },
  { prefixe: '/parametres', permissions: ['menu_parametres'] },
  { prefixe: '/super-admin/tenants', permissions: ['menu_tenants'] },
  { prefixe: '/super-admin/comptes', permissions: ['menu_comptes_acces'] },
  { prefixe: '/super-admin/roles', permissions: ['menu_gestion_roles'] },
]

export function regleDePage(chemin) {
  return REGLES_PAGES.find((r) => chemin === r.prefixe || chemin.startsWith(r.prefixe + '/')) || null
}

export function pageAutorisee(regle, hasPermission, roleNom) {
  if (!regle) return true
  if (regle.superAdmin && String(roleNom || '').toLowerCase() === 'super_admin') return true
  return regle.permissions.some((p) => hasPermission(p))
}

// Où renvoyer quelqu'un qui n'a pas le droit — ce que faisaient les pages :
// le Dashboard renvoie le livreur à Livraisons, l'agent au Centre d'appel,
// les autres à la connexion ; toute autre page renvoie au Dashboard.
export function redirectionPour(regle, roleNom) {
  if (regle?.prefixe !== '/dashboard') return '/dashboard'
  const role = String(roleNom || '').toLowerCase()
  if (role === 'livreur') return '/livraisons'
  if (role === 'agent') return '/centre-appel'
  return '/'
}
