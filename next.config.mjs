// En-têtes de sécurité (16/11/2026, revue de sécurité du 13/11, point 3).
//
// Étape 1 : les en-têtes simples sont appliqués ; la Content-Security-Policy
// est en « Report-Only » : le navigateur ne bloque rien, il écrit seulement
// dans la console (F12) ce qu'il AURAIT bloqué. Quand la console reste propre
// sur toutes les pages, étape 2 : remplacer 'Content-Security-Policy-Report-Only'
// par 'Content-Security-Policy' (une ligne, plus bas).
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
// serveur — pas maintenant. Le point qui compte reste fermé : connect-src
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
  // Étape 2 : 'Content-Security-Policy-Report-Only' → 'Content-Security-Policy'.
  { key: 'Content-Security-Policy-Report-Only', value: csp },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: enTetes }]
  },
}

export default nextConfig
