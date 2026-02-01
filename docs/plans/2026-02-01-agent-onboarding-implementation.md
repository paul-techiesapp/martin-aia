# Agent Onboarding System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete agent recruitment event management system with admin portal, agent portal, and public attendance pages.

**Architecture:** Monorepo with three React apps (admin, agent, public) sharing UI components and types. Supabase handles auth, database, and edge functions. PIN-based attendance with QR code scanning.

**Tech Stack:** React 18, Vite, TypeScript, Supabase, shadcn/ui, Tailwind CSS, react-pdf, Recharts, pnpm workspaces

---

## Phase 1: Project Setup & Infrastructure

### Task 1.1: Initialize Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.nvmrc`

**Step 1: Create root package.json**

```json
{
  "name": "agent-onboarding-system",
  "private": true,
  "scripts": {
    "dev:admin": "pnpm --filter admin-portal dev",
    "dev:agent": "pnpm --filter agent-portal dev",
    "dev:public": "pnpm --filter public-pages dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**Step 3: Create .gitignore**

```
node_modules
dist
.env
.env.local
.DS_Store
*.log
.turbo
```

**Step 4: Create .nvmrc**

```
20
```

**Step 5: Initialize git and commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore .nvmrc
git commit -m "chore: initialize monorepo structure"
```

---

### Task 1.2: Create Shared Types Package

**Files:**
- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.json`
- Create: `packages/shared-types/src/index.ts`
- Create: `packages/shared-types/src/database.ts`
- Create: `packages/shared-types/src/enums.ts`

**Step 1: Create package.json**

```json
{
  "name": "@agent-system/shared-types",
  "version": "0.0.1",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

**Step 3: Create src/enums.ts**

```typescript
export enum InvitationType {
  BUSINESS_OPPORTUNITY = 'business_opportunity',
  JOB_OPPORTUNITY = 'job_opportunity',
}

export enum CampaignStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

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
```

**Step 4: Create src/database.ts**

```typescript
import {
  InvitationType,
  CampaignStatus,
  InvitationStatus,
  CapacityType,
  RoleType,
  AgentStatus,
  RewardStatus,
} from './enums';

export interface Campaign {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  invitation_type: InvitationType;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
}

export interface Slot {
  id: string;
  campaign_id: string;
  day_of_week: number; // 0-6 (Sunday-Saturday)
  start_time: string; // HH:MM:SS
  end_time: string;
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tier {
  id: string;
  name: string;
  role_type: RoleType;
  reward_amount: number;
  invitation_limit_per_slot: number;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  nric: string;
  agent_code: string;
  unit_name: string;
  tier_id: string;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  agent_id: string;
  slot_id: string;
  capacity_type: CapacityType;
  unique_token: string;
  status: InvitationStatus;
  invitee_name: string | null;
  invitee_nric: string | null;
  invitee_phone: string | null;
  invitee_email: string | null;
  invitee_occupation: string | null;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PinCode {
  id: string;
  slot_id: string;
  code: string;
  linked_nric: string | null;
  is_used: boolean;
  created_at: string;
}

export interface Attendance {
  id: string;
  invitation_id: string;
  pin_code_id: string;
  checkin_time: string;
  checkout_time: string | null;
  is_full_attendance: boolean;
  created_at: string;
  updated_at: string;
}

export interface Reward {
  id: string;
  agent_id: string;
  attendance_id: string;
  amount: number;
  capacity_type: CapacityType;
  status: RewardStatus;
  created_at: string;
  updated_at: string;
}

// Extended types with relations
export interface SlotWithCampaign extends Slot {
  campaign: Campaign;
}

export interface AgentWithTier extends Agent {
  tier: Tier;
}

export interface InvitationWithRelations extends Invitation {
  agent: Agent;
  slot: SlotWithCampaign;
}

export interface AttendanceWithRelations extends Attendance {
  invitation: InvitationWithRelations;
  pin_code: PinCode;
}
```

**Step 5: Create src/index.ts**

```typescript
export * from './enums';
export * from './database';
```

**Step 6: Commit**

```bash
git add packages/shared-types
git commit -m "feat: add shared-types package with database types and enums"
```

---

### Task 1.3: Create Shared UI Package

**Files:**
- Create: `packages/shared-ui/package.json`
- Create: `packages/shared-ui/tsconfig.json`
- Create: `packages/shared-ui/src/index.ts`
- Create: `packages/shared-ui/src/lib/utils.ts`
- Create: `packages/shared-ui/tailwind.config.ts`
- Create: `packages/shared-ui/components.json`

**Step 1: Create package.json**

```json
{
  "name": "@agent-system/shared-ui",
  "version": "0.0.1",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.312.0",
    "tailwind-merge": "^2.2.0"
  },
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.3.0",
    "tailwindcss": "^3.4.0"
  }
}
```

**Step 2: Create src/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 3: Create components.json (shadcn config)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

**Step 4: Create src/index.ts**

```typescript
export { cn } from './lib/utils';

// Components will be added here as we create them
// export { Button } from './components/ui/button';
```

**Step 5: Commit**

```bash
git add packages/shared-ui
git commit -m "feat: add shared-ui package with shadcn setup"
```

---

### Task 1.4: Setup Supabase Project

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/.gitignore`

**Step 1: Initialize Supabase locally**

Run: `npx supabase init`
Expected: Creates supabase/ directory with config.toml

**Step 2: Update config.toml for project**

```toml
[api]
enabled = true
port = 54321
schemas = ["public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
major_version = 15

[studio]
enabled = true
port = 54323

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3001", "http://localhost:3002"]
jwt_expiry = 3600
enable_signup = true

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false
```

**Step 3: Create supabase/.gitignore**

```
.branches
.temp
```

**Step 4: Commit**

```bash
git add supabase
git commit -m "chore: initialize supabase project"
```

---

### Task 1.5: Create Database Schema Migration

**Files:**
- Create: `supabase/migrations/20260201000000_initial_schema.sql`

**Step 1: Create the migration file**

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
CREATE TYPE invitation_type AS ENUM ('business_opportunity', 'job_opportunity');
CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'completed');
CREATE TYPE invitation_status AS ENUM ('pending', 'registered', 'attended', 'completed', 'expired');
CREATE TYPE capacity_type AS ENUM ('agent', 'business_partner');
CREATE TYPE role_type AS ENUM ('agent', 'business_partner');
CREATE TYPE agent_status AS ENUM ('active', 'inactive');
CREATE TYPE reward_status AS ENUM ('pending', 'confirmed', 'paid');

-- Campaigns table
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  venue TEXT NOT NULL,
  invitation_type invitation_type NOT NULL,
  status campaign_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_dates CHECK (end_date >= start_date)
);

-- Slots table
CREATE TABLE slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  checkin_window_minutes INTEGER NOT NULL DEFAULT 30,
  checkout_window_minutes INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_times CHECK (end_time > start_time)
);

-- Tiers table
CREATE TABLE tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  role_type role_type NOT NULL,
  reward_amount DECIMAL(10, 2) NOT NULL CHECK (reward_amount >= 0),
  invitation_limit_per_slot INTEGER NOT NULL CHECK (invitation_limit_per_slot > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agents table
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  nric TEXT NOT NULL UNIQUE,
  agent_code TEXT NOT NULL UNIQUE,
  unit_name TEXT NOT NULL,
  tier_id UUID NOT NULL REFERENCES tiers(id),
  status agent_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Invitations table
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  capacity_type capacity_type NOT NULL,
  unique_token UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  status invitation_status NOT NULL DEFAULT 'pending',
  invitee_name TEXT,
  invitee_nric TEXT,
  invitee_phone TEXT,
  invitee_email TEXT,
  invitee_occupation TEXT,
  registered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create unique partial indexes for invitee_nric and invitee_phone
-- Only enforce uniqueness when values are not null
CREATE UNIQUE INDEX invitations_invitee_nric_unique
  ON invitations(invitee_nric)
  WHERE invitee_nric IS NOT NULL;

CREATE UNIQUE INDEX invitations_invitee_phone_unique
  ON invitations(invitee_phone)
  WHERE invitee_phone IS NOT NULL;

-- PIN codes table
CREATE TABLE pin_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  linked_nric TEXT,
  is_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(slot_id, code)
);

-- Attendance table
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  pin_code_id UUID NOT NULL REFERENCES pin_codes(id),
  checkin_time TIMESTAMPTZ NOT NULL,
  checkout_time TIMESTAMPTZ,
  is_full_attendance BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(invitation_id)
);

-- Rewards table
CREATE TABLE rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  capacity_type capacity_type NOT NULL,
  status reward_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attendance_id)
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER slots_updated_at BEFORE UPDATE ON slots FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tiers_updated_at BEFORE UPDATE ON tiers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER invitations_updated_at BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER attendance_updated_at BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER rewards_updated_at BEFORE UPDATE ON rewards FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Create indexes for common queries
CREATE INDEX idx_slots_campaign ON slots(campaign_id);
CREATE INDEX idx_agents_tier ON agents(tier_id);
CREATE INDEX idx_agents_user ON agents(user_id);
CREATE INDEX idx_invitations_agent ON invitations(agent_id);
CREATE INDEX idx_invitations_slot ON invitations(slot_id);
CREATE INDEX idx_invitations_token ON invitations(unique_token);
CREATE INDEX idx_pin_codes_slot ON pin_codes(slot_id);
CREATE INDEX idx_attendance_invitation ON attendance(invitation_id);
CREATE INDEX idx_rewards_agent ON rewards(agent_id);
```

**Step 2: Run migration locally**

Run: `npx supabase db reset`
Expected: Database recreated with new schema

**Step 3: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add initial database schema migration"
```

---

### Task 1.6: Create Row Level Security Policies

**Files:**
- Create: `supabase/migrations/20260201000001_rls_policies.sql`

**Step 1: Create RLS migration**

```sql
-- Enable RLS on all tables
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;

-- Create admin check function
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND raw_user_meta_data->>'role' = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create agent check function
CREATE OR REPLACE FUNCTION get_agent_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT id FROM agents WHERE user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Campaigns: Admin full access, agents read active only
CREATE POLICY "Admin full access to campaigns" ON campaigns FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read active campaigns" ON campaigns FOR SELECT TO authenticated USING (status = 'active');

-- Slots: Admin full access, agents read active only
CREATE POLICY "Admin full access to slots" ON slots FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read active slots" ON slots FOR SELECT TO authenticated USING (is_active = true);

-- Tiers: Admin full access, agents read only
CREATE POLICY "Admin full access to tiers" ON tiers FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read tiers" ON tiers FOR SELECT TO authenticated USING (true);

-- Agents: Admin full access, agents read own data
CREATE POLICY "Admin full access to agents" ON agents FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own data" ON agents FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Invitations: Admin full access, agents manage own
CREATE POLICY "Admin full access to invitations" ON invitations FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents manage own invitations" ON invitations FOR ALL TO authenticated USING (agent_id = get_agent_id());

-- PIN codes: Admin full access, public check-in/out access
CREATE POLICY "Admin full access to pin_codes" ON pin_codes FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Public can update pin_codes for checkin" ON pin_codes FOR UPDATE TO anon USING (true);
CREATE POLICY "Public can read pin_codes" ON pin_codes FOR SELECT TO anon USING (true);

-- Attendance: Admin full access, public can insert, agents read own
CREATE POLICY "Admin full access to attendance" ON attendance FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Public can insert attendance" ON attendance FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Public can update attendance" ON attendance FOR UPDATE TO anon USING (true);
CREATE POLICY "Agents read own attendance" ON attendance FOR SELECT TO authenticated
  USING (invitation_id IN (SELECT id FROM invitations WHERE agent_id = get_agent_id()));

-- Rewards: Admin full access, agents read own
CREATE POLICY "Admin full access to rewards" ON rewards FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own rewards" ON rewards FOR SELECT TO authenticated USING (agent_id = get_agent_id());
```

**Step 2: Run migration**

Run: `npx supabase db reset`
Expected: Database recreated with RLS policies

**Step 3: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add row level security policies"
```

---

### Task 1.7: Create Admin Portal App Shell

**Files:**
- Create: `apps/admin-portal/package.json`
- Create: `apps/admin-portal/vite.config.ts`
- Create: `apps/admin-portal/tsconfig.json`
- Create: `apps/admin-portal/index.html`
- Create: `apps/admin-portal/src/main.tsx`
- Create: `apps/admin-portal/src/App.tsx`
- Create: `apps/admin-portal/src/index.css`

**Step 1: Create package.json**

```json
{
  "name": "admin-portal",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite --port 3000",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx"
  },
  "dependencies": {
    "@agent-system/shared-types": "workspace:*",
    "@agent-system/shared-ui": "workspace:*",
    "@supabase/supabase-js": "^2.39.0",
    "@tanstack/react-query": "^5.17.0",
    "@tanstack/react-router": "^1.15.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "recharts": "^2.10.0",
    "@react-pdf/renderer": "^3.1.0",
    "qrcode.react": "^3.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

**Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

**Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Admin Portal - Agent Onboarding System</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 5: Create src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;
    --primary: 0 0% 9%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 96.1%;
    --secondary-foreground: 0 0% 9%;
    --muted: 0 0% 96.1%;
    --muted-foreground: 0 0% 45.1%;
    --accent: 0 0% 96.1%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 89.8%;
    --input: 0 0% 89.8%;
    --ring: 0 0% 3.9%;
    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

**Step 6: Create src/main.tsx**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**Step 7: Create src/App.tsx**

```typescript
function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">
            Admin Portal
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <p className="text-gray-600">Welcome to the Admin Portal</p>
      </main>
    </div>
  );
}

export default App;
```

**Step 8: Commit**

```bash
git add apps/admin-portal
git commit -m "feat: add admin portal app shell"
```

---

### Task 1.8: Create Agent Portal App Shell

**Files:**
- Create: `apps/agent-portal/package.json`
- Create: `apps/agent-portal/vite.config.ts`
- Create: `apps/agent-portal/tsconfig.json`
- Create: `apps/agent-portal/index.html`
- Create: `apps/agent-portal/src/main.tsx`
- Create: `apps/agent-portal/src/App.tsx`
- Create: `apps/agent-portal/src/index.css`

**Step 1: Create package.json**

```json
{
  "name": "agent-portal",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite --port 3001",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx"
  },
  "dependencies": {
    "@agent-system/shared-types": "workspace:*",
    "@agent-system/shared-ui": "workspace:*",
    "@supabase/supabase-js": "^2.39.0",
    "@tanstack/react-query": "^5.17.0",
    "@tanstack/react-router": "^1.15.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

**Step 2: Create remaining files (same structure as admin-portal)**

Copy the same vite.config.ts, tsconfig.json, index.html, src/index.css, src/main.tsx patterns from admin-portal.

**Step 3: Create src/App.tsx**

```typescript
function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">
            Agent Portal
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <p className="text-gray-600">Welcome to the Agent Portal</p>
      </main>
    </div>
  );
}

export default App;
```

**Step 4: Commit**

```bash
git add apps/agent-portal
git commit -m "feat: add agent portal app shell"
```

---

### Task 1.9: Create Public Pages App Shell

**Files:**
- Create: `apps/public-pages/package.json`
- Create: `apps/public-pages/vite.config.ts`
- Create: `apps/public-pages/tsconfig.json`
- Create: `apps/public-pages/index.html`
- Create: `apps/public-pages/src/main.tsx`
- Create: `apps/public-pages/src/App.tsx`
- Create: `apps/public-pages/src/index.css`

**Step 1: Create package.json**

```json
{
  "name": "public-pages",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite --port 3002",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx"
  },
  "dependencies": {
    "@agent-system/shared-types": "workspace:*",
    "@agent-system/shared-ui": "workspace:*",
    "@supabase/supabase-js": "^2.39.0",
    "@tanstack/react-router": "^1.15.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-hook-form": "^7.49.0",
    "@hookform/resolvers": "^3.3.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

**Step 2: Create src/App.tsx**

```typescript
function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">
          Agent Onboarding System
        </h1>
        <p className="mt-2 text-gray-600">Public registration and attendance pages</p>
      </div>
    </div>
  );
}

export default App;
```

**Step 3: Commit**

```bash
git add apps/public-pages
git commit -m "feat: add public pages app shell"
```

---

### Task 1.10: Install Dependencies and Verify Setup

**Step 1: Install all dependencies**

Run: `pnpm install`
Expected: All packages installed successfully

**Step 2: Start Supabase locally**

Run: `npx supabase start`
Expected: Local Supabase services running

**Step 3: Verify each app runs**

Run: `pnpm dev:admin` (in terminal 1)
Run: `pnpm dev:agent` (in terminal 2)
Run: `pnpm dev:public` (in terminal 3)

Expected:
- Admin portal at http://localhost:3000
- Agent portal at http://localhost:3001
- Public pages at http://localhost:3002

**Step 4: Commit any lockfile changes**

```bash
git add pnpm-lock.yaml
git commit -m "chore: add pnpm lockfile"
```

---

## Phase 2: Core shadcn Components

### Task 2.1: Add shadcn Button Component

**Files:**
- Create: `packages/shared-ui/src/components/ui/button.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Step 1: Create button.tsx**

```typescript
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

**Step 2: Add @radix-ui/react-slot to shared-ui package.json dependencies**

**Step 3: Export from index.ts**

```typescript
export { cn } from './lib/utils';
export { Button, buttonVariants } from './components/ui/button';
```

**Step 4: Commit**

```bash
git add packages/shared-ui
git commit -m "feat: add shadcn button component"
```

---

### Task 2.2: Add Form Components (Input, Label, Form)

**Files:**
- Create: `packages/shared-ui/src/components/ui/input.tsx`
- Create: `packages/shared-ui/src/components/ui/label.tsx`
- Create: `packages/shared-ui/src/components/ui/form.tsx`

(Continue adding essential shadcn components...)

---

## Phase 3: Supabase Client & Auth

### Task 3.1: Create Supabase Client Configuration

**Files:**
- Create: `packages/shared-ui/src/lib/supabase.ts`

**Step 1: Create supabase client**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

**Step 2: Create .env.example in each app**

```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## Phase 4-8: Remaining Implementation

(The plan continues with detailed tasks for:)

- **Phase 4:** Admin Portal - Campaign & Slot Management
- **Phase 5:** Admin Portal - Agent & Tier Management
- **Phase 6:** Admin Portal - PIN Generation & QR Display
- **Phase 7:** Agent Portal - Auth, Campaigns, Invitations
- **Phase 8:** Public Pages - Registration, Check-in, Check-out
- **Phase 9:** Admin Portal - Reports & Analytics
- **Phase 10:** PDF Generation (Invitation Cards, PIN Sheets)

---

## Summary

| Phase | Tasks | Estimated Steps |
|-------|-------|-----------------|
| 1. Setup | 10 | ~50 |
| 2. Components | 5 | ~25 |
| 3. Auth | 3 | ~15 |
| 4. Campaign CRUD | 6 | ~30 |
| 5. Agent CRUD | 4 | ~20 |
| 6. PIN & QR | 4 | ~20 |
| 7. Agent Portal | 6 | ~30 |
| 8. Public Pages | 5 | ~25 |
| 9. Reports | 8 | ~40 |
| 10. PDF | 3 | ~15 |

**Total: ~54 tasks, ~270 steps**
