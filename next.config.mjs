// En-têtes de sécurité (16/11/2026, revue de sécurité du 13/11, point 3).
//
// Étape 1 (16/11) : en-têtes simples appliqués, CSP en « Report-Only ».
// Étape 2 (17/11) : console restée propre sur toutes les pages → la CSP est
// appliquée : le navigateur BLOQUE ce qui n'est pas dans la liste.
// Retour arrière en cas de page cassée : remettre la clé
// 'Content-Security-Policy-Report-Only' (une ligne, plus bas) et pousser.
//
// La liste suit ce que le CRM utilise vraiment (lu dans le code le 16/11) :
//   - Supabase : base (PostgREST), Auth, Edge Functions, Storage (images
//     produits, bucket public), realtime en wss au cas où ;
//   - Google Fonts (app/globals.css, dashboard, paramètres) ;
//   - data: / blob: : aperçu de l'image réduite, téléchargement des exports.
// Un nouveau service externe (CDN, analytics…) doit être ajouté ici, sinon il
// sera bloqué à l'étape 2.
//
// 'unsafe-inline' dans script-src : Next met ses propres petits scripts dans
// la page. La version stricte (nonce) obligerait à rendre chaque page côté
// serveur — pas maintenant. Le point qui compte est fermé : connect-src
// empêche un script injecté d'envoyer le jeton de session ailleurs.

const supabase = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://meeboyokamgwwbhxfclf.supabase.co').replace(/\/+$/, '')
const supabaseWs = supabase.replace(/^http/, 'ws')
const dev = process.env.NODE_ENV !== 'production'

const csp = [
  "default-src 'self'",
  // 'unsafe-eval' seulement en dev (rechargement à chaud de Next).
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${supabase}`,
  `connect-src 'self' ${supabase} ${supabaseWs}${dev ? ' ws:' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const enTetes = [
  // Personne ne met le CRM dans un cadre (clickjacking), même pas lui-même.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Vers un autre site : seulement le domaine, jamais l'adresse de la page.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Le CRM n'utilise ni caméra, ni micro, ni position, ni paiement navigateur.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // Appliquée depuis le 17/11 (Report-Only du 16/11 au 17/11, console propre).
  { key: 'Content-Security-Policy', value: csp },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: enTetes }]
  },
}

export default nextConfig
