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
  PAID = 'paid',
}
