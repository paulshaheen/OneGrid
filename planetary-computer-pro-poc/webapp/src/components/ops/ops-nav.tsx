import { Link } from "@tanstack/react-router";
import type { ComponentPropsWithoutRef, ReactElement } from "react";

export type OpsBase = "/app";

/** The console is served under /app/* (tenant data). Kept as a helper so views
 * and links resolve their paths from a single place. */
export function useOpsBase(): OpsBase {
  return "/app";
}

type OpsLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  /** Path relative to the console root, e.g. "/risk" or "/" for the overview. */
  to: string;
};

export function OpsLink({ to, ...rest }: OpsLinkProps) {
  const base = useOpsBase();
  const href = to === "/" ? base : `${base}${to}`;
  const AnyLink = Link as unknown as (props: Record<string, unknown>) => ReactElement;
  return <AnyLink to={href} {...rest} />;
}
