import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const variants = {
  default: "bg-primary text-primary-foreground active:opacity-90",
  secondary: "bg-secondary text-secondary-foreground active:opacity-90",
  ghost: "bg-transparent text-foreground active:bg-muted",
  outline: "border border-border bg-transparent active:bg-muted"
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
}

export function Button({ className, variant = "default", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
