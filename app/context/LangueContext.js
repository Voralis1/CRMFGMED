'use client'

// La langue de l'écran (25/11/2026). Chacun choisit FR / EN avec le bouton de
// la barre du haut (ou de la page de connexion) ; le choix est gardé dans CE
// navigateur (localStorage), sans SQL. Tout le CRM suit : t('cle') rend le
// texte de la langue choisie, et retombe sur le français pour une clé pas
// encore traduite.
//
//   const { t, langue, setLangue, locale } = useLangue()
//   t('nav.commandes')              → « Commandes » / « Orders »
//   t('lot.traitees', { n: 3, … })  → les {n} sont remplacés

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { LANGUES, LANGUE_DEFAUT, definirLangue, localeDe, traduire } from '../../lib/langues/index.mjs'

const CLE_STOCKAGE = 'crm_langue'
const LangueContext = createContext(null)

export function LangueProvider({ children }) {
  const [langue, setLangueEtat] = useState(LANGUE_DEFAUT)

  // Le choix gardé, lu après le premier rendu (le serveur ne connaît pas le
  // navigateur : lire avant ferait un écart d'hydratation).
  useEffect(() => {
    try {
      const garde = window.localStorage.getItem(CLE_STOCKAGE)
      if (garde && LANGUES.some((l) => l.code === garde)) setLangueEtat(garde)
    } catch { /* stockage bloqué : on reste en français */ }
  }, [])

  // Hors de React aussi (messageErreur) : tenue à jour à chaque rendu.
  definirLangue(langue)

  useEffect(() => {
    document.documentElement.lang = langue
  }, [langue])

  const setLangue = useCallback((code) => {
    if (!LANGUES.some((l) => l.code === code)) return
    definirLangue(code)
    setLangueEtat(code)
    try { window.localStorage.setItem(CLE_STOCKAGE, code) } catch { /* rien */ }
  }, [])

  const t = useCallback((cle, vars) => traduire(cle, vars, langue), [langue])

  const valeur = useMemo(() => ({ langue, setLangue, t, locale: localeDe(langue), langues: LANGUES }), [langue, setLangue, t])
  return <LangueContext.Provider value={valeur}>{children}</LangueContext.Provider>
}

const SECOURS = { langue: LANGUE_DEFAUT, setLangue: () => {}, t: (cle, vars) => traduire(cle, vars, LANGUE_DEFAUT), locale: 'fr-FR', langues: LANGUES }

export function useLangue() {
  return useContext(LangueContext) || SECOURS
}
