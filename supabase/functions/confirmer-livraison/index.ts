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

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('roles(nom)')
    .eq('user_id', user.id)
    .maybeSingle()

  const roleNom = roleData?.roles?.nom?.toLowerCase()

  if (!roleNom || (roleNom !== 'admin' && roleNom !== 'livreur' && roleNom !== 'super_admin')) {
    return new Response(JSON.stringify({ error: 'Accès refusé : rôle insuffisant' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const payload = await req.json()
  const { livraison_id, statut, motif_retour, montant_a_encaisser } = payload

  if (!livraison_id || !statut) {
    return new Response(JSON.stringify({ error: 'livraison_id et statut requis' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const statutsValides = ['expedie', 'livre', 'injoignable', 'retour']
  if (!statutsValides.includes(statut)) {
    return new Response(JSON.stringify({ error: 'statut invalide' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 🚀 CORRECTION 1 : On demande à Supabase de nous donner aussi le tenant_id de cette livraison
  const { data: livraison, error: erreurLecture } = await supabase
    .from('livraisons')
    .select('id, commande_id, livreur_id, tenant_id') // 👈 Ajout du tenant_id
    .eq('id', livraison_id)
    .single()

  if (erreurLecture || !livraison) {
    return new Response(JSON.stringify({ error: 'livraison introuvable' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { error: erreurUpdate } = await supabase
    .from('livraisons')
    .update({
      statut,
      motif_retour: statut === 'retour' ? (motif_retour || null) : null,
      date_livraison: statut === 'livre' ? new Date().toISOString() : null
    })
    .eq('id', livraison_id)

  if (erreurUpdate) {
    return new Response(JSON.stringify({ error: erreurUpdate.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await supabase
    .from('commandes')
    .update({ statut_livraison: statut, updated_at: new Date().toISOString() })
    .eq('id', livraison.commande_id)

  let paiement = null
  if (statut === 'livre') {
    const { data: nouveauPaiement, error: erreurPaiement } = await supabase
      .from('paiements')
      .insert({
        commande_id: livraison.commande_id,
        livreur_id: livraison.livreur_id,
        tenant_id: livraison.tenant_id, // 🚀 CORRECTION 2 : On insère le tenant_id dans le paiement !
        montant: montant_a_encaisser || 0,
        methode: 'cod',
        statut: 'en_attente'
      })
      .select()
      .single()

    // 🚀 CORRECTION 3 : Si la création du paiement échoue, on affiche l'erreur au lieu de la cacher !
    if (erreurPaiement) {
      return new Response(JSON.stringify({ error: "Erreur création paiement: " + erreurPaiement.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    paiement = nouveauPaiement
    await supabase
      .from('commandes')
      .update({ statut_paiement: 'en_attente' })
      .eq('id', livraison.commande_id)
  }

  return new Response(JSON.stringify({ status: 'ok', livraison_id, paiement }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})