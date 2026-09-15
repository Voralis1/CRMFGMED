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

  try {
    const { user_id, email, nouveau_mdp } = await req.json()

    if (!user_id) {
      throw new Error("L'identifiant utilisateur (user_id) est requis.")
    }

    const updateData = {}
    if (email) updateData.email = email
    if (nouveau_mdp && nouveau_mdp.trim() !== '') {
      updateData.password = nouveau_mdp
    }

    const { data, error } = await supabase.auth.admin.updateUserById(user_id, updateData)

    if (error) throw error

    return new Response(JSON.stringify({ status: 'ok', user: data.user }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})