"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
};

const SIZE: Record<Size, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
};

interface BaseProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

function content({ loading, icon, iconRight, children }: BaseProps) {
  return (
    <>
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
      {!loading && iconRight}
    </>
  );
}

export type ButtonProps = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn("btn", VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {content({ loading, icon, iconRight, children })}
    </button>
  );
});

export type ButtonLinkProps = BaseProps &
  Omit<React.ComponentProps<typeof Link>, "children">;

export function ButtonLink({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={cn("btn", VARIANT[variant], SIZE[size], className)} {...rest}>
      {content({ icon, iconRight, children })}
    </Link>
  );
}

/** Square icon-only button with an accessible label. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "children" | "size"> & { label: string; size?: number }
>(function IconButton({ label, icon, className, size = 16, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)]",
        "transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
        className,
      )}
      style={{ ["--icon-size" as string]: `${size}px` }}
      {...rest}
    >
      {icon}
    </button>
  );
});
