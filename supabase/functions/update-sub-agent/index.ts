// supabase/functions/update-sub-agent/index.ts
// Unit-side agent editing. Round 6: Unit Manager (root) edits anyone in the
// unit incl. deputies and the deputy flag; Unit Admins (deputies) edit plain
// Unit Agents only. Email changes must ripple to auth.users (login email),
// which RLS-scoped table updates cannot do — hence this function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Missing authorization header' });
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData.user) return json(401, { error: 'Invalid token' });

    const { data: caller } = await supabase
      .from('agents')
      .select('id, parent_agent_id, is_unit_manager')
      .eq('user_id', userData.user.id)
      .single();
    if (!caller) return json(403, { error: 'Only agents can update unit members' });
    const callerIsRoot = caller.parent_agent_id === null;
    if (!callerIsRoot && caller.is_unit_manager !== true) {
      return json(403, { error: 'Only unit managers or unit admins can update agents' });
    }
    const unitRootId = caller.parent_agent_id ?? caller.id;

    const body = await req.json();
    const { agent_id, password, ...fields } = body as Record<string, unknown> & {
      agent_id?: string;
      password?: string;
    };
    if (!agent_id) return json(400, { error: 'agent_id is required' });

    const { data: target } = await supabase
      .from('agents')
      .select('id, user_id, parent_agent_id, is_unit_manager, email')
      .eq('id', agent_id)
      .single();
    if (!target) return json(404, { error: 'Agent not found' });

    const targetIsRoot = target.parent_agent_id === null;
    const inUnit = targetIsRoot ? target.id === unitRootId : target.parent_agent_id === unitRootId;
    if (!inUnit) return json(403, { error: 'Agent is not in your unit' });
    if (targetIsRoot) {
      return json(403, { error: 'The Unit Manager can only be edited by the master admin' });
    }
    if (!callerIsRoot && target.is_unit_manager === true) {
      return json(403, { error: 'Only the Unit Manager can edit a Unit Admin' });
    }
    if ('is_unit_manager' in fields && !callerIsRoot) {
      return json(403, { error: 'Only the Unit Manager can change the Unit Admin flag' });
    }

    const allowed = ['name', 'email', 'phone', 'nric', 'agent_code', 'tier_id', 'status', 'is_unit_manager'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (key in fields) updates[key] = fields[key];
    if ('nric' in updates && updates.nric === '') updates.nric = null;

    // Sync auth.users first so a failure leaves the agents row untouched.
    const authUpdates: { email?: string; password?: string } = {};
    if (typeof updates.email === 'string' && updates.email !== target.email) {
      authUpdates.email = updates.email as string;
    }
    if (password) {
      if (password.length < 6) return json(400, { error: 'Password must be at least 6 characters' });
      authUpdates.password = password;
    }
    if (Object.keys(authUpdates).length > 0) {
      const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(
        target.user_id,
        { ...authUpdates, email_confirm: true },
      );
      if (authUpdateErr) {
        const conflict = authUpdateErr.message?.toLowerCase().includes('already');
        return json(conflict ? 409 : 400, { error: authUpdateErr.message });
      }
    }

    if (Object.keys(updates).length > 0) {
      const { data: updated, error: updateErr } = await supabase
        .from('agents')
        .update(updates)
        .eq('id', agent_id)
        .select()
        .single();
      if (updateErr) {
        // Roll back the auth-side email change so login email and agents.email
        // cannot diverge (password changes are not reverted — they carry no
        // cross-table consistency requirement).
        if (authUpdates.email) {
          await supabase.auth.admin.updateUserById(target.user_id, {
            email: target.email,
            email_confirm: true,
          });
        }
        return json(400, { error: updateErr.message });
      }
      return json(200, { success: true, agent: updated });
    }
    return json(200, { success: true, agent: target });
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
});
