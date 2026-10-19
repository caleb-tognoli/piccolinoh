import type { ComponentChildren, JSX } from "preact";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "xs" | "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "bg-raised text-ink border border-line hover:border-muted/60",
  ghost: "text-muted hover:text-ink hover:bg-raised",
};

const sizes: Record<Size, string> = {
  xs: "h-7 px-2.5 text-xs gap-1",
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

const iconSizes: Record<Size, string> = {
  xs: "size-7",
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
};

type Props = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
  variant?: Variant;
  size?: Size;
  /** Square button holding only an icon; pass `aria-label`. */
  icon?: boolean;
  children?: ComponentChildren;
};

export function Button({ variant = "secondary", size = "md", icon, class: className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      class={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center font-medium transition-colors select-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        icon ? cn(iconSizes[size], "rounded-full") : cn(sizes[size], "rounded-lg"),
        className as string,
      )}
    >
      {children}
    </button>
  );
}
