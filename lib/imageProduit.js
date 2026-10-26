// L'image d'un produit (26/10) — Supabase Storage, bucket « produits »
// (supabase/sql/produits_image.sql). Une seule copie de ces règles pour les
// écrans Produits, Paramètres, Commandes, Expéditions et Livraisons.
//
// Le chemin : <entreprise>/<produit>/<uuid>.<ext>. Le produit doit EXISTER
// avant l'envoi : la policy du bucket demande « cette personne peut-elle
// modifier ce produit ? », et elle le lit dans le chemin.
//
// Ce qui est envoyé n'est pas la photo d'origine : le navigateur la réduit
// à 800 px de côté, en WebP. Le plafond de 2 Mo est imposé par le bucket,
// au cas où un appel contournerait cet écran.
//
// SUPPRIMER UN FICHIER : la base ne le peut pas (Supabase refuse un DELETE
// sur storage.objects). C'est donc l'écran qui le fait — en remplaçant, en
// retirant, en supprimant le produit —, et TOUJOURS AVANT de supprimer le
// produit : une fois le produit parti, plus personne n'a le droit de toucher
// à son fichier. Ce qui échappe aux écrans se lit dans la vue
// v_images_produits_orphelines (éditeur SQL).
import { supabase } from './supabaseClient'

export const BUCKET_IMAGES = 'produits'
const COTE_MAX = 800
const PLAFOND = 2 * 1024 * 1024          // le file_size_limit du bucket
const TYPES_ACCEPTES = ['image/jpeg', 'image/png', 'image/webp']

// L'URL publique (bucket public : pas d'URL signée à renouveler). Rien si
// le produit n'a pas d'image.
export function urlImage(chemin) {
  if (!chemin) return null
  return supabase.storage.from(BUCKET_IMAGES).getPublicUrl(chemin).data?.publicUrl || null
}

// La photo choisie → { blob, ext } réduite, ou une erreur en français.
export async function reduireImage(fichier) {
  if (!fichier) throw new Error('Aucun fichier.')
  if (!TYPES_ACCEPTES.includes(fichier.type)) {
    throw new Error('Image JPG, PNG ou WebP seulement.')
  }

  const source = await chargerImage(fichier)
  const echelle = Math.min(1, COTE_MAX / Math.max(source.width, source.height))
  const largeur = Math.max(1, Math.round(source.width * echelle))
  const hauteur = Math.max(1, Math.round(source.height * echelle))

  const canvas = document.createElement('canvas')
  canvas.width = largeur
  canvas.height = hauteur
  canvas.getContext('2d').drawImage(source, 0, 0, largeur, hauteur)
  if (typeof source.close === 'function') source.close()

  // WebP d'abord. Un navigateur qui ne sait pas l'encoder rend un PNG à la
  // place (vieux Safari) : on passe alors en JPEG, plus léger qu'un PNG.
  let blob = await versBlob(canvas, 'image/webp', 0.82)
  let ext = 'webp'
  if (!blob || blob.type !== 'image/webp') {
    blob = await versBlob(canvas, 'image/jpeg', 0.85)
    ext = 'jpg'
  }
  if (!blob) throw new Error('Image illisible.')
  if (blob.size > PLAFOND) throw new Error('Image trop lourde, même réduite (2 Mo maximum).')
  return { blob, ext }
}

function versBlob(canvas, type, qualite) {
  return new Promise((ok) => canvas.toBlob(ok, type, qualite))
}

async function chargerImage(fichier) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(fichier) } catch { /* l'élément <img> essaie à son tour */ }
  }
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(fichier)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); ok(img) }
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Image illisible.')) }
    img.src = url
  })
}

// Envoie l'image réduite d'un produit DÉJÀ ENREGISTRÉ, et rend son chemin.
export async function envoyerImage(tenantId, produitId, { blob, ext }) {
  const chemin = `${tenantId}/${produitId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET_IMAGES).upload(chemin, blob, {
    contentType: ext === 'jpg' ? 'image/jpeg' : 'image/webp',
    cacheControl: '31536000',          // un chemin ne change jamais de contenu
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return chemin
}

// Retire un fichier. Rend l'erreur au lieu de la lever : un retrait raté
// laisse un orphelin (visible dans la vue), jamais un produit cassé.
export async function retirerImage(chemin) {
  if (!chemin) return null
  const { error } = await supabase.storage.from(BUCKET_IMAGES).remove([chemin])
  return error ? error.message : null
}
