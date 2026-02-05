/**
 * Design Tokens for Agent Onboarding System
 * Centralized design system tokens for consistent styling across all portals
 */

// Color palette - Navy/Blue enterprise theme
export const colors = {
  // Primary colors
  primary: {
    navy: '#0F172A',      // Main navy primary
    blue: '#0369A1',      // CTA blue accent
    slate: '#F8FAFC',     // Light background
  },

  // Semantic status colors
  status: {
    success: '#059669',   // Emerald-600
    warning: '#D97706',   // Amber-600
    error: '#DC2626',     // Red-600
    info: '#0284C7',      // Sky-600
    neutral: '#64748B',   // Slate-500
  },

  // Extended palette for charts and data visualization
  chart: {
    primary: '#0369A1',   // Blue
    secondary: '#0F172A', // Navy
    tertiary: '#059669',  // Emerald
    quaternary: '#D97706', // Amber
    quinary: '#8B5CF6',   // Violet
    senary: '#EC4899',    // Pink
  },
} as const;

// Chart colors array for Recharts
export const chartColors = [
  colors.chart.primary,
  colors.chart.secondary,
  colors.chart.tertiary,
  colors.chart.quaternary,
  colors.chart.quinary,
  colors.chart.senary,
];

// Status color mappings for different entity states
export const statusColors = {
  // Campaign status
  campaign: {
    draft: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
    active: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
    paused: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
    completed: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  },

  // Invitation status
  invitation: {
    pending: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
    registered: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
    attended: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
    expired: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' },
  },

  // Reward status
  reward: {
    pending: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
    approved: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
    paid: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  },

  // Agent status
  agent: {
    active: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
    inactive: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
    suspended: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' },
  },
} as const;

// Glassmorphism effect classes
export const glassmorphism = {
  card: 'bg-white/80 backdrop-blur-sm border border-white/20 shadow-lg',
  cardHover: 'hover:bg-white/90 hover:shadow-xl transition-all duration-200',
  panel: 'bg-white/60 backdrop-blur-md border border-white/30',
  overlay: 'bg-slate-900/60 backdrop-blur-sm',
} as const;

// Animation presets
export const animations = {
  fadeIn: 'animate-fade-in',
  slideUp: 'animate-slide-up',
  pulse: 'animate-pulse',
} as const;

// Spacing scale (consistent with Tailwind)
export const spacing = {
  xs: '0.25rem',  // 4px
  sm: '0.5rem',   // 8px
  md: '1rem',     // 16px
  lg: '1.5rem',   // 24px
  xl: '2rem',     // 32px
  '2xl': '3rem',  // 48px
} as const;

// Border radius scale
export const borderRadius = {
  sm: '0.375rem',  // 6px
  md: '0.5rem',    // 8px
  lg: '0.75rem',   // 12px
  xl: '1rem',      // 16px
  full: '9999px',
} as const;

// Shadow scale
export const shadows = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
} as const;

// Typography
export const typography = {
  fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  fontWeights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

// Transition presets
export const transitions = {
  fast: 'transition-all duration-150 ease-out',
  normal: 'transition-all duration-200 ease-out',
  slow: 'transition-all duration-300 ease-out',
} as const;
