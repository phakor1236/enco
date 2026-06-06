import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, id, className, ...rest },
  ref,
) {
  const inputId = id ?? `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={inputId} className="text-[12.5px] font-semibold tracking-wide text-ink-2">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'h-[46px] rounded-[12px] border-[1.5px] border-line bg-surface px-[14px]',
          'placeholder:text-ink-faint',
          'transition-[border-color,box-shadow] duration-150',
          'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-tint-2',
          error && 'border-danger focus:ring-danger-tint',
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-err` : undefined}
        {...rest}
      />
      {error && (
        <span id={`${inputId}-err`} className="text-xs font-semibold text-danger">
          {error}
        </span>
      )}
    </div>
  );
});
