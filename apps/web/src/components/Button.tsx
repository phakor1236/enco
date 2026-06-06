import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

type Variant = 'primary' | 'ink' | 'ghost' | 'soft' | 'danger' | 'quiet';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-press',
  ink: 'bg-ink text-white hover:bg-ink-2',
  ghost: 'bg-transparent text-ink border-line hover:bg-surface',
  soft: 'bg-primary-tint text-primary-press hover:bg-primary-tint-2',
  danger: 'bg-danger text-white hover:bg-danger',
  quiet: 'bg-transparent text-ink-soft hover:bg-paper-2 hover:text-ink',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-9 px-[13px] text-[13px]',
  md: 'h-11 px-[18px] text-[14.5px]',
  lg: 'h-[52px] px-[26px] text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full border border-transparent',
        'font-semibold tracking-wide select-none whitespace-nowrap',
        'transition-[transform,box-shadow,background-color] duration-150',
        'hover:-translate-y-px hover:shadow-md active:translate-y-0 active:shadow-none',
        'disabled:opacity-45 disabled:pointer-events-none',
        'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
        variantClasses[variant],
        sizeClasses[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    />
  );
});
