'use client'

// Les messages du CRM (24/11/2026). Remplacent les fenêtres du navigateur
// (alert / confirm), qui bloquaient la page, ne ressemblaient pas au CRM, et
// qu'un navigateur peut proposer de « bloquer » — les confirmations ne
// s'affichaient alors plus du tout.
//
//   const { annoncer, confirmer } = useMessages()
//   annoncer('Commande créée.', 'succes')          // 'succes' | 'erreur' | 'info'
//   if (!(await confirmer({ message: 'Supprimer ?', bouton: 'Supprimer', danger: true }))) return
//
// annoncer : une petite boîte en bas à droite, qui part seule (une erreur
// reste plus longtemps, et se ferme d'un clic). Rien n'est bloqué.
// confirmer : une fenêtre au style du CRM ; rend true / false. Échap = Annuler.
// Avec `saisie: { label, placeholder }` : un champ texte obligatoire dans la
// fenêtre ; rend le texte saisi (non vide), ou false si annulé.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { traduire } from '../../lib/langues/index.mjs'
import { useLangue } from '../context/LangueContext'

const MessagesContext = createContext(null)

const DUREE = { succes: 4000, info: 6000, erreur: 9000 }
const STYLE = {
  succes: { bord: '#2E7D53', fond: '#EAF4EE', icone: '✓' },
  erreur: { bord: '#A35139', fond: '#F8ECE8', icone: '!' },
  info: { bord: '#1B2632', fond: '#FFFFFF', icone: 'i' },
}

export function MessagesProvider({ children }) {
  const { t } = useLangue()
  const [annonces, setAnnonces] = useState([])
  const [demande, setDemande] = useState(null) // { message, titre, bouton, danger, resoudre }
  const compteur = useRef(0)

  const fermer = useCallback((id) => setAnnonces((l) => l.filter((a) => a.id !== id)), [])

  const annoncer = useCallback((texte, type = 'info') => {
    if (!texte) return
    const id = ++compteur.current
    const t = STYLE[type] ? type : 'info'
    // Au plus 4 à la fois : la plus ancienne part.
    setAnnonces((l) => [...l.slice(-3), { id, texte: String(texte), type: t }])
    setTimeout(() => fermer(id), DUREE[t])
  }, [fermer])

  // La demande en cours aussi dans une ref : la réponse est rendue une seule
  // fois, hors d'un setState (React peut rejouer un updater).
  const enCours = useRef(null)

  const confirmer = useCallback((options) => new Promise((resoudre) => {
    const o = typeof options === 'string' ? { message: options } : (options || {})
    enCours.current?.resoudre(false) // une demande déjà ouverte = annulée
    const d = { titre: o.titre || traduire('msg.confirmer'), message: o.message || '', bouton: o.bouton || traduire('msg.confirmer'), danger: !!o.danger, saisie: o.saisie || null, id: ++compteur.current, resoudre }
    enCours.current = d
    setDemande(d)
  }), [])

  const repondre = useCallback((oui) => {
    const d = enCours.current
    enCours.current = null
    setDemande(null)
    d?.resoudre(oui)
  }, [])

  const valeur = useMemo(() => ({ annoncer, confirmer }), [annoncer, confirmer])

  return (
    <MessagesContext.Provider value={valeur}>
      {children}

      {/* Les annonces : en bas à droite (en bas, pleine largeur sur téléphone). */}
      <div aria-live="polite" className="fixed z-[200] bottom-4 left-4 right-4 sm:left-auto sm:w-[380px] flex flex-col gap-2 pointer-events-none sans-impression">
        {annonces.map((a) => {
          const s = STYLE[a.type]
          return (
            <div key={a.id} role={a.type === 'erreur' ? 'alert' : 'status'}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border shadow-lg px-4 py-3 text-sm text-[#1B2632]"
              style={{ background: s.fond, borderColor: `${s.bord}66` }}>
              <span className="shrink-0 w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center mt-0.5" style={{ background: s.bord }}>{s.icone}</span>
              <p className="flex-1 whitespace-pre-line leading-snug">{a.texte}</p>
              <button type="button" onClick={() => fermer(a.id)} aria-label={t('msg.fermer')} className="shrink-0 text-[#1B2632]/40 hover:text-[#1B2632] cursor-pointer">✕</button>
            </div>
          )
        })}
      </div>

      {demande && <FenetreConfirmation key={demande.id} demande={demande} repondre={repondre} />}
    </MessagesContext.Provider>
  )
}

function FenetreConfirmation({ demande, repondre }) {
  const { t } = useLangue()
  const annuler = useRef(null)
  const valider = useRef(null)
  const champ = useRef(null)
  const [texte, setTexte] = useState('')
  const saisieVide = !!demande.saisie && !texte.trim()
  const envoyer = () => { if (!saisieVide) repondre(demande.saisie ? texte.trim() : true) }

  useEffect(() => {
    // Un champ à remplir : le curseur dedans. Une suppression : sur
    // « Annuler », pour qu'un Entrée réflexe ne supprime rien. Sinon sur le
    // bouton d'action.
    ;(demande.saisie ? champ : demande.danger ? annuler : valider).current?.focus()
    const touche = (e) => { if (e.key === 'Escape') { e.preventDefault(); repondre(false) } }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [demande, repondre])

  return (
    <div className="fixed inset-0 z-[210] bg-[#1B2632]/45 backdrop-blur-sm flex items-center justify-center p-4 sans-impression"
      onMouseDown={(e) => { if (e.target === e.currentTarget) repondre(false) }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirmation-titre"
        className="bg-white rounded-2xl shadow-2xl border border-[#C9C1B1]/60 w-full max-w-md p-6">
        <h3 id="confirmation-titre" className="text-lg font-bold text-[#1B2632]">{demande.titre}</h3>
        <p className="mt-2 text-sm text-[#1B2632]/75 whitespace-pre-line leading-relaxed">{demande.message}</p>
        {demande.saisie && (
          <div className="mt-4">
            <label htmlFor="confirmation-saisie" className="block text-xs font-bold uppercase tracking-wide text-[#1B2632]/60 mb-1.5">{demande.saisie.label || t('msg.raison')} *</label>
            <input id="confirmation-saisie" ref={champ} type="text" value={texte} onChange={(e) => setTexte(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); envoyer() } }}
              placeholder={demande.saisie.placeholder || ''}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C1B1] text-sm text-[#1B2632] outline-none focus:border-[#1B2632]" />
          </div>
        )}
        <div className="mt-6 flex gap-3 justify-end">
          <button ref={annuler} type="button" onClick={() => repondre(false)}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-[#EEE9DF] text-[#1B2632] hover:bg-[#E3DDD0] cursor-pointer">
            {t('msg.annuler')}
          </button>
          <button ref={valider} type="button" onClick={envoyer} disabled={saisieVide}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${demande.danger ? 'bg-[#A35139] hover:bg-[#8E4631]' : 'bg-[#1B2632] hover:bg-[#2C3B4D]'}`}>
            {demande.bouton}
          </button>
        </div>
      </div>
    </div>
  )
}

// Hors du fournisseur (ne devrait pas arriver) : on retombe sur le navigateur
// plutôt que de perdre un message ou de supprimer sans demander.
const SECOURS = {
  annoncer: (texte) => { if (texte && typeof window !== 'undefined') window.alert(texte) },
  confirmer: async (o) => {
    if (typeof window === 'undefined') return false
    const message = typeof o === 'string' ? o : o?.message || ''
    if (o?.saisie) return (window.prompt(message) || '').trim() || false
    return window.confirm(message)
  },
}

export function useMessages() {
  return useContext(MessagesContext) || SECOURS
}
