import type { HTMLAttributes, ReactNode } from "react";

import styles from "./chip.module.css";

export interface ChipProps extends Omit<HTMLAttributes<HTMLElement>, "className"> {
  readonly children: ReactNode;
  /** Makes the chip a link, such as to a search for its value. */
  readonly href?: string | undefined;
}

/** A small status or label chip. Elanor has no badge component. */
export function Chip({ href, ...props }: ChipProps): React.JSX.Element {
  return href === undefined ? (
    <span {...props} className={styles["chip"]} />
  ) : (
    <a {...props} className={styles["chip"]} href={href} />
  );
}

export function LifecycleStateChip({
  href,
  state,
}: {
  readonly href?: string | undefined;
  readonly state: string;
}): React.JSX.Element {
  return (
    <Chip data-lifecycle-state={state.trim().toLocaleLowerCase("en")} href={href}>
      {state}
    </Chip>
  );
}

export function VisibilityChip({
  href,
  visibility,
}: {
  readonly href?: string | undefined;
  readonly visibility: string;
}): React.JSX.Element {
  return (
    <Chip data-document-visibility={visibility} href={href}>
      {visibility}
    </Chip>
  );
}
