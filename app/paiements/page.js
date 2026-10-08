'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'
import ReglementsVendeurs from '../components/paiements/ReglementsVendeurs'
import CaisseLivreurs from '../components/paiements/CaisseLivreurs'

// Un seul menu « Paiements », et chacun y trouve ce qui le concerne :
//
//   le livreur          l'argent qu'il a encaissé chez les clients
//   le vendeur          ses relevés de paiement
//   le responsable      les deux, en deux onglets
//
// Deux menus séparés auraient obligé chaque personne à retenir lequel est le
// sien. La base, elle, ne change pas : ce sont toujours deux tables et deux
// jeux de policies — l'écran ne fait que montrer celles qui s'appliquent.

export default function PaiementsPage() {
  const { user, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  // Ce que cette personne a le droit de voir ici. On se fie aux permissions,
  // pas au nom du rôle : c'est la même source que la base.
  const vues = useMemo(() => {
    const liste = []
    if (hasPermission('menu_reglements')) liste.push({ cle: 'vendeurs', nom: 'Relevés vendeurs' })
    // `voir_caisse`, pas `menu_paiements` : le seller a bien le menu Paiements
    // — ce sont ses relevés — mais l'argent encaissé par les livreurs ne le
    // regarde pas. La fiche de passation le dit en toutes lettres (8.5).
    if (hasPermission('voir_caisse')) liste.push({ cle: 'livreurs', nom: 'Caisse livreurs' })
    return liste
  }, [hasPermission])

  // Le premier onglet auquel on a droit. Le seller n'en a qu'un, les
  // responsables en ont deux et arrivent sur les relevés.
  const [onglet, setOnglet] = useState(null)
  useEffect(() => {
    if (onglet || vues.length === 0) return
    setOnglet(vues[0].cle)
  }, [vues, onglet])

  useEffect(() => {
    if (authLoading || permsLoading) return
    if (!user) router.replace('/')
    else if (vues.length === 0) router.replace('/dashboard')
  }, [user, authLoading, permsLoading, vues, router])

  if (authLoading || permsLoading || !onglet) {
    return <div className="p-12 text-center text-[#1B2632]/60 font-medium">Chargement...</div>
  }

  return (
    <>
      {/* Un seul onglet disponible : on n'affiche pas une barre d'onglets
          pour un seul choix, elle ne ferait qu'occuper de la place. */}
      {vues.length > 1 && (
        <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 pt-4 sm:pt-16 sans-impression">
          <div className="flex flex-wrap gap-2">
            {vues.map((v) => (
              <button
                key={v.cle}
                onClick={() => setOnglet(v.cle)}
                className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  onglet === v.cle
                    ? 'bg-[#1B2632] text-white shadow-md'
                    : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                {v.nom}
              </button>
            ))}
          </div>
        </div>
      )}

      {onglet === 'vendeurs' ? <ReglementsVendeurs /> : <CaisseLivreurs />}
    </>
  )
}