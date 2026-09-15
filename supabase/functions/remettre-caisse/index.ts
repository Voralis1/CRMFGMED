import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  const { data: { user }, error: erreurUser } = await supabase.auth.getUser(token)

  if (erreurUser || !user) {
    return new Response(JSON.stringify({ error: 'Non authentifié' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Utilisation de la relation avec la table "roles" (nom)
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('roles(nom)')
    .eq('user_id', user.id)
    .maybeSingle()

  const roleNom = roleData?.roles?.nom?.toLowerCase()

  if (!roleNom || (roleNom !== 'admin' && roleNom !== 'super_admin')) {
    return new Response(JSON.stringify({ error: 'Accès refusé : réservé aux admins' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const payload = await req.json()
  const { livreur_id, devise } = payload

  if (!livreur_id) {
    return new Response(JSON.stringify({ error: 'livreur_id requis' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!devise) {
    return new Response(JSON.stringify({ error: 'devise requise' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 🚀 ÉTAPE 1 : on va chercher les paiements "encaisse" de ce livreur, avec la
  // devise de leur commande. On ne peut pas filtrer par une colonne d'une table
  // liée (commandes -> pays -> devise) directement dans un .update(), donc on
  // identifie d'abord les bons IDs.
  const { data: paiementsCandidats, error: erreurLecture } = await supabase
    .from('paiements')
    .select('id, montant, commandes(pays(devise))')
    .eq('livreur_id', livreur_id)
    .eq('statut', 'encaisse')

  if (erreurLecture) {
    return new Response(JSON.stringify({ error: erreurLecture.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 🚀 ÉTAPE 2 : on ne garde que les paiements dont la devise correspond exactement
  // à celle demandée. C'est ce qui empêche de mélanger AOA / MAD / XAF dans une
  // seule remise.
  const paiementsAConfirmer = (paiementsCandidats || []).filter(
    (p) => p.commandes?.pays?.devise === devise
  )

  if (paiementsAConfirmer.length === 0) {
    return new Response(
      JSON.stringify({ status: 'ok', nombre_paiements: 0, total_remis: 0 }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const idsAConfirmer = paiementsAConfirmer.map((p) => p.id)

  // 🚀 ÉTAPE 3 : on met à jour UNIQUEMENT ces paiements précis (par ID), jamais
  // tous les paiements du livreur.
  const { data: paiements, error } = await supabase
    .from('paiements')
    .update({ statut: 'remis' })
    .in('id', idsAConfirmer)
    .select()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const total = paiements.reduce((somme, p) => somme + Number(p.montant), 0)

  return new Response(
    JSON.stringify({ status: 'ok', nombre_paiements: paiements.length, total_remis: total, devise }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})