import type { HTMLAttributes, ReactNode } from "react";

interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  as?: "section" | "aside" | "div";
}

/** Restrained glass instrument panel. Re-enables pointer events inside the click-through HUD stage. */
export function Panel({ title, actions, as: Tag = "section", className = "", children, ...rest }: PanelProps) {
  return (
    <Tag className={`glass pointer-events-auto ${className}`} {...rest}>
      {(title || actions) && (
        <header className="hairline flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </Tag>
  );
}
