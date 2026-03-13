import logoSrc from '../assets/logo.png';
import { cn } from '../lib/utils';

const sizeMap = {
  sm: { image: 32, text: 'text-sm' },
  md: { image: 36, text: 'text-base' },
  lg: { image: 56, text: 'text-xl' },
} as const;

export interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  const { image, text } = sizeMap[size];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <img
        src={logoSrc}
        alt="RACC Agency"
        width={image}
        height={image}
        className="object-contain"
      />
      {showText && (
        <span className={cn('font-semibold', text)}>RACC Agency</span>
      )}
    </div>
  );
}
