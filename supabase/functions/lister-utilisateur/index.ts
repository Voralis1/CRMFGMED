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

  try {
    // Récupérer tous les utilisateurs de l'Auth
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers()
    if (authError) throw authError

    // Récupérer les rôles et tenants depuis user_roles
    const { data: userRoles, error: roleError } = await supabase
      .from('user_roles')
      .select('*')

    if (roleError) throw roleError

    // Fusionner les données (associer l'email à chaque user_id)
    const result = userRoles.map((ur) => {
      const match = authUsers.users.find((u) => u.id === ur.user_id)
      return {
        ...ur,
        email: match ? match.email : 'Email inconnu'
      }
    })

    return new Response(JSON.stringify({ status: 'ok', comptes: result }), {
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