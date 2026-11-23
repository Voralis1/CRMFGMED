'use client'

// Mon profil (refait le 23/11, sa décision « plan A »).
//
// Avant : un formulaire prénom / nom / téléphone / RIB / banque qui écrivait
// dans `agents` — une table qui n'a ni prénom, ni téléphone, ni RIB, ni banque
// (lu en prod le 23/11 : id, nom, pays_id, actif, tenant_id, user_id).
// « Mettre à jour le profil » finissait donc en erreur pour tout le monde, et
// pour tout rôle qui n'est pas agent les champs restaient vides.
//
// Maintenant : qui je suis, en lecture (nom, e-mail, rôle, entreprise — un
// admin les change dans Utilisateurs), et la seule chose que chacun peut
// vraiment changer lui-même : son mot de passe. RIB et banque retirés (sa
// demande) : rien ne les enregistrait.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

// Même règle que Supabase Auth (8 caractères depuis le 17/11) et que
// Utilisateurs : refusé ici avant que le serveur le refuse.
const MIN_MOT_DE_PASSE = 8

export default function ProfilPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { roleNom, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId

  const [infos, setInfos] = useState(null)
  const [message, setMessage] = useState({ texte: '', type: '' })
  const [nouveau, setNouveau] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [voirNouveau, setVoirNouveau] = useState(false)
  const [voirConfirmation, setVoirConfirmation] = useState(false)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) router.replace('/')
  }, [user, authLoading, router])

  // Le nom vient de user_roles (chaque compte y a sa ligne, quel que soit son
  // rôle) ; l'entreprise, de tenants.
  useEffect(() => {
    if (!user || permsLoading) return
    let fini = false
    ;(async () => {
      const [{ data: roles }, { data: entreprise }] = await Promise.all([
        supabase.from('user_roles').select('nom, email').eq('user_id', user.id).limit(1),
        tenantKey
          ? supabase.from('tenants').select('nom_entreprise').eq('id', tenantKey).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (fini) return
      setInfos({
        nom: roles?.[0]?.nom || '',
        email: user.email || roles?.[0]?.email || '',
        role: roleNom || '',
        entreprise: entreprise?.nom_entreprise || '',
      })
    })()
    return () => { fini = true }
  }, [user, tenantKey, roleNom, permsLoading])

  function annonce(texte, type) {
    setMessage({ texte, type })
    setTimeout(() => setMessage({ texte: '', type: '' }), 6000)
  }

  async function changerMotDePasse(e) {
    e.preventDefault()
    if (!user) return
    if (nouveau.length < MIN_MOT_DE_PASSE) return annonce(`Le mot de passe doit contenir au moins ${MIN_MOT_DE_PASSE} caractères.`, 'erreur')
    if (nouveau !== confirmation) return annonce('Les deux mots de passe ne sont pas identiques.', 'erreur')
    setEnCours(true)
    const { error } = await supabase.auth.updateUser({ password: nouveau })
    setEnCours(false)
    if (error) {
      // Supabase refuse aussi un mot de passe trop faible ou identique à l'ancien.
      annonce(/weak|short|least/i.test(error.message)
        ? `Mot de passe trop faible (${MIN_MOT_DE_PASSE} caractères minimum).`
        : /same|different/i.test(error.message)
          ? "Choisissez un mot de passe différent de l'actuel."
          : 'Le mot de passe n’a pas pu être changé. Réessayez.', 'erreur')
      return
    }
    setNouveau(''); setConfirmation('')
    annonce('Mot de passe changé.', 'succes')
  }

  if (authLoading || permsLoading || !infos) {
    return <div className="p-12 text-center text-[#1B2632]/60 font-medium">Chargement du profil...</div>
  }

  const tropCourt = nouveau.length > 0 && nouveau.length < MIN_MOT_DE_PASSE
  const differents = confirmation.length > 0 && confirmation !== nouveau

  return (
    <div className="flex flex-col gap-6 w-full max-w-[900px] mx-auto pt-4 sm:pt-2 px-4 sm:px-6 pb-10">
      <h1 className="text-2xl font-bold text-[#1B2632]">Mon profil</h1>

      {message.texte && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium border ${
          message.type === 'erreur'
            ? 'bg-[#A35139]/10 border-[#A35139]/30 text-[#A35139]'
            : 'bg-[#2E7D53]/10 border-[#2E7D53]/30 text-[#2E7D53]'}`}>
          {message.texte}
        </div>
      )}

      {/* Qui je suis — en lecture. */}
      <section className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm p-6 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[#1B2632] text-white flex items-center justify-center text-xl font-bold shrink-0">
            {(infos.nom || infos.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-[#1B2632] truncate">{infos.nom || <span className="font-normal italic text-[#1B2632]/40">sans nom</span>}</p>
            <p className="text-sm text-[#1B2632]/60 truncate">{infos.email}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-[#C9C1B1]/40 pt-4">
          <Info label="Rôle" valeur={infos.role ? infos.role.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—'} />
          <Info label="Entreprise" valeur={infos.entreprise || '—'} />
          <Info label="E-mail de connexion" valeur={infos.email || '—'} />
        </div>
        <p className="text-xs text-[#1B2632]/50">
          Pour changer votre nom ou votre rôle, demandez à un administrateur (menu Utilisateurs).
        </p>
      </section>

      {/* Le mot de passe — la seule chose que chacun change lui-même. */}
      <form onSubmit={changerMotDePasse} className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm p-6 flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-bold text-[#1B2632]">Mot de passe</h2>
          <p className="text-sm text-[#1B2632]/60 mt-0.5">Choisissez un nouveau mot de passe d&apos;au moins {MIN_MOT_DE_PASSE} caractères.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <ChampMotDePasse id="nouveau-mdp" label="Nouveau mot de passe" valeur={nouveau} setValeur={setNouveau}
            voir={voirNouveau} setVoir={setVoirNouveau}
            aide={`${MIN_MOT_DE_PASSE} caractères minimum${nouveau ? ` · ${nouveau.length} tapé${nouveau.length > 1 ? 's' : ''}` : ''}`}
            erreur={tropCourt} />
          <ChampMotDePasse id="confirmation-mdp" label="Confirmer le mot de passe" valeur={confirmation} setValeur={setConfirmation}
            voir={voirConfirmation} setVoir={setVoirConfirmation}
            aide={differents ? 'Les deux mots de passe ne sont pas identiques.' : confirmation && !differents ? 'Identiques.' : 'Tapez-le une seconde fois.'}
            erreur={differents} />
        </div>
        <div className="flex justify-end">
          <button type="submit"
            disabled={enCours || nouveau.length < MIN_MOT_DE_PASSE || nouveau !== confirmation}
            className="px-6 py-3 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
            {enCours ? 'Modification…' : 'Changer le mot de passe'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Info({ label, valeur }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[#1B2632]/45 mb-1">{label}</p>
      <p className="text-sm font-semibold text-[#1B2632] truncate">{valeur}</p>
    </div>
  )
}

function ChampMotDePasse({ id, label, valeur, setValeur, voir, setVoir, aide, erreur }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">{label}</label>
      <div className={`flex items-center rounded-xl border bg-white px-3.5 transition-colors focus-within:border-[#1B2632] ${erreur ? 'border-[#A35139]/60' : 'border-[#C9C1B1]'}`}>
        <input id={id} type={voir ? 'text' : 'password'} value={valeur} onChange={(e) => setValeur(e.target.value)}
          autoComplete="new-password" placeholder="••••••••"
          className="w-full py-3 text-sm text-[#1B2632] outline-none bg-transparent" />
        <button type="button" onClick={() => setVoir((v) => !v)} title={voir ? 'Masquer' : 'Afficher'}
          className="ml-2 text-[#1B2632]/45 hover:text-[#1B2632] cursor-pointer">
          {voir ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          )}
        </button>
      </div>
      <p className={`text-[11px] mt-1.5 ${erreur ? 'text-[#A35139] font-semibold' : 'text-[#1B2632]/45'}`}>{aide}</p>
    </div>
  )
}
