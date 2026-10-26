'use client'

import { useState } from 'react'
import { urlImage } from '../../lib/imageProduit'

// La vignette d'un produit. Sans image — produit sans photo, produit non
// reconnu, fichier introuvable —, jamais d'image cassée :
//   vide = 'carre' → un carré gris de la même taille (les noms restent alignés)
//   vide = 'rien'  → rien du tout
export default function VignetteProduit({ chemin, taille = 40, vide = 'carre', alt = '' }) {
  const [echec, setEchec] = useState(null)
  const url = urlImage(chemin)
  const style = { width: taille, height: taille }

  if (!url || echec === url) {
    if (vide === 'rien') return null
    return <span className="inline-block shrink-0 rounded-md bg-[#EEE9DF] border border-[#C9C1B1]/50" style={style} />
  }
  return (
    // <img> et non next/image : le bucket est public et l'URL déjà finale,
    // next/image demanderait de déclarer le domaine Supabase.
    <img
      src={url} alt={alt} loading="lazy" style={style}
      onError={() => setEchec(url)}
      className="inline-block shrink-0 rounded-md object-cover bg-[#EEE9DF] border border-[#C9C1B1]/50"
    />
  )
}
