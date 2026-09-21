// Shared helpers for every Edge Function.
// Every function runs with the SERVICE ROLE key, which BYPASSES RLS.
// So the security checks MUST be done here, in code: who is calling,
// which tenant they belong to, and which permissions their role has.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-import-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export interface Caller {
  userId: string
  email: string | undefined
  tenantId: string
  roleId: string | null
  roleNom: string
  isSuperAdmin: boolean
  permissions: Set<string>
}

// Identifies the logged-in caller from the Authorization header,
// then loads their role, tenant and permissions from the database.
export async function getCaller(req: Request, sb: SupabaseClient): Promise<Caller> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) throw new HttpError(401, 'Non authentifié')

  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) throw new HttpError(401, 'Non authentifié')

  const { data: ur } = await sb
    .from('user_roles')
    .select('tenant_id, role, role_id, roles(nom)')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!ur) throw new HttpError(403, 'Aucun rôle attribué à ce compte')

  // deno-lint-ignore no-explicit-any
  const roleNom = String((ur as any).roles?.nom ?? ur.role ?? '').toLowerCase()
  const isSuperAdmin = roleNom === 'super_admin'

  // A suspended/archived tenant loses access (super_admin is platform-level).
  if (!isSuperAdmin) {
    const { data: tenant } = await sb.from('tenants').select('statut').eq('id', ur.tenant_id).maybeSingle()
    if (!tenant || tenant.statut !== 'actif') {
      throw new HttpError(403, 'Entreprise suspendue ou introuvable')
    }
  }

  // Permissions come from role_permissions (managed in /super-admin/roles).
  let roleId: string | null = ur.role_id ?? null
  if (!roleId && roleNom) {
    const { data: r } = await sb.from('roles').select('id').eq('nom', roleNom).eq('is_system', true).maybeSingle()
    roleId = r?.id ?? null
  }

  const permissions = new Set<string>()
  if (roleId) {
    const { data: perms } = await sb.from('role_permissions').select('permission_code').eq('role_id', roleId)
    for (const p of perms ?? []) permissions.add(p.permission_code)
  }

  return {
    userId: user.id,
    email: user.email,
    tenantId: ur.tenant_id,
    roleId,
    roleNom,
    isSuperAdmin,
    permissions,
  }
}

// Throws 403 unless the caller has at least one of the given permissions.
// super_admin always passes.
export function requireAny(caller: Caller, codes: string[]): void {
  if (caller.isSuperAdmin) return
  if (codes.some((c) => caller.permissions.has(c))) return
  throw new HttpError(403, 'Accès refusé : permission insuffisante')
}

// Throws 403 if the resource belongs to another tenant (super_admin always passes).
export function assertTenant(caller: Caller, tenantId: string | null | undefined): void {
  if (caller.isSuperAdmin) return
  if (!tenantId || tenantId !== caller.tenantId) {
    throw new HttpError(403, 'Accès refusé : ressource d\'une autre entreprise')
  }
}

// The caller's own row in `livreurs` / `agents` (null if none).
export async function myLivreurId(sb: SupabaseClient, caller: Caller): Promise<string | null> {
  const { data } = await sb.from('livreurs').select('id').eq('user_id', caller.userId).eq('tenant_id', caller.tenantId).maybeSingle()
  return data?.id ?? null
}

export async function myAgentId(sb: SupabaseClient, caller: Caller, tenantId: string): Promise<string | null> {
  const { data } = await sb.from('agents').select('id').eq('user_id', caller.userId).eq('tenant_id', tenantId).maybeSingle()
  return data?.id ?? null
}

// Roles that only admin / super_admin may create, edit or delete.
export const ROLES_PRIVILEGIES = ['admin', 'ceo', 'manager']

// Wraps a handler: CORS preflight, POST only, and uniform error responses.
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)
    try {
      return await fn(req)
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status)
      console.error(err)
      // deno-lint-ignore no-explicit-any
      return json({ error: (err as any)?.message || 'Erreur interne du serveur' }, 500)
    }
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body : {}
  } catch {
    throw new HttpError(400, 'Corps de requête JSON invalide')
  }
}