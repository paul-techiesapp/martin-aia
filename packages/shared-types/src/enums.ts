export enum InvitationType {
  BUSINESS_OPPORTUNITY = 'business_opportunity',
  JOB_OPPORTUNITY = 'job_opportunity',
}

/** @alias InvitationType — renamed for the registration-based model */
export type RegistrationType = InvitationType;

export enum CampaignStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

export enum RegistrationStatus {
  REGISTERED = 'registered',
  ATTENDED = 'attended',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
}

/**
 * @deprecated Use {@link RegistrationStatus} instead.
 * Kept temporarily for backwards compatibility during migration.
 */
export enum InvitationStatus {
  PENDING = 'pending',
  REGISTERED = 'registered',
  ATTENDED = 'attended',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
}

export enum CapacityType {
  AGENT = 'agent',
  BUSINESS_PARTNER = 'business_partner',
}

export enum RoleType {
  AGENT = 'agent',
  BUSINESS_PARTNER = 'business_partner',
}

export enum AgentStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum RewardStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  /** Reward has been sent/issued to the agent. Displayed as "Issued" in the UI. */
  PAID = 'paid',
  /** Issuing the reward failed; see Reward.failure_reason. */
  FAILED = 'failed',
}

export enum TierRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
