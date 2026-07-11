import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { MerchantStatus, type Merchant, type MerchantBranch } from '@agent-system/shared-types';

export interface MerchantWithBranches extends Merchant {
  // RLS returns only active OR agent-owned branches, so this array already
  // excludes other agents' pending proposals.
  branches: MerchantBranch[];
}

// Every merchant row the agent is allowed to see (active ones for browsing +
// the agent's own pending proposals), each with its visible branches embedded.
export function useAgentMerchants() {
  return useQuery({
    queryKey: ['agent-merchants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select('*, branches:merchant_branches(*)')
        .order('name', { ascending: true });

      if (error) throw error;
      return data as MerchantWithBranches[];
    },
  });
}

export interface ProposeMerchantInput {
  agentId: string;
  name: string;
  contactPerson: string;
  contactPhone: string;
  branch: { name: string; address: string; phone: string };
  agreementFile: File;
}

// Agent proposes a new merchant with full info + signed agreement.
// RLS requires status='pending' and created_by_agent_id=get_agent_id();
// money terms are admin-set on approval. The agreement goes to the private
// merchant-agreements bucket under the agent's own prefix.
export function useProposeMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProposeMerchantInput) => {
      const safeName = input.agreementFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${input.agentId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from('merchant-agreements')
        .upload(path, input.agreementFile, {
          contentType: input.agreementFile.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: merchant, error } = await supabase
        .from('merchants')
        .insert({
          name: input.name,
          contact_person: input.contactPerson.trim() || null,
          contact_phone: input.contactPhone.trim() || null,
          agreement_path: path,
          status: MerchantStatus.PENDING,
          created_by_agent_id: input.agentId,
        })
        .select()
        .single();
      if (error) throw error;

      const { error: branchError } = await supabase.from('merchant_branches').insert({
        merchant_id: merchant.id,
        name: input.branch.name.trim() || input.name,
        address: input.branch.address.trim() || null,
        phone: input.branch.phone.trim() || null,
        status: MerchantStatus.PENDING,
        created_by_agent_id: input.agentId,
      });
      if (branchError) throw branchError;

      return merchant as Merchant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-merchants'] });
    },
  });
}

// Agent proposes a branch under a merchant (the merchant may be active or the
// agent's own pending one). RLS requires status='pending' + own created_by.
export function useProposeBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      merchantId,
      name,
      address,
      phone,
      agentId,
    }: {
      merchantId: string;
      name: string;
      address: string;
      phone: string;
      agentId: string;
    }) => {
      const { data, error } = await supabase
        .from('merchant_branches')
        .insert({
          merchant_id: merchantId,
          name,
          address: address.trim() === '' ? null : address.trim(),
          phone: phone.trim() === '' ? null : phone.trim(),
          status: MerchantStatus.PENDING,
          created_by_agent_id: agentId,
        })
        .select()
        .single();

      if (error) throw error;
      return data as MerchantBranch;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-merchants'] });
    },
  });
}

// Merchant ids the agent is branch-linked to (their own branch QR links).
// RLS "Agents manage own branch_links" already scopes rows to the caller.
// Only active links into active branches count, mirroring
// merchant_available_to_agent() in the database.
export function useMyLinkedMerchantIds(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-linked-merchants', agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_links')
        .select('branch:merchant_branches(merchant_id, status)')
        .eq('agent_id', agentId!)
        .eq('is_active', true);
      if (error) throw error;
      const ids = new Set<string>();
      for (const row of (data ?? []) as unknown as { branch: { merchant_id: string; status: string } | null }[]) {
        if (row.branch?.merchant_id && row.branch.status === 'active') ids.add(row.branch.merchant_id);
      }
      return ids;
    },
  });
}
