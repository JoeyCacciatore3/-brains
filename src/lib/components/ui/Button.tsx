import { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}

export function Button({
  children,
  variant = 'primary',
  className,
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    'px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-green-500 hover:bg-green-600 text-black border-2 border-green-600',
    secondary: 'bg-black hover:bg-gray-900 text-white border-2 border-green-500',
    danger: 'bg-black hover:bg-gray-900 text-white border-2 border-green-500',
  };

  return (
    <button className={cn(baseStyles, variants[variant], className)} disabled={disabled} {...props}>
      {children}
    </button>
  );
}
