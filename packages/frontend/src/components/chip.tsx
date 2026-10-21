import styles from "./chip.module.css";

export interface LifecycleStateChipProps {
  readonly className?: string | undefined;
  readonly href?: string | undefined;
  readonly state: string;
}

export function LifecycleStateChip({
  className,
  href,
  state,
}: LifecycleStateChipProps): React.JSX.Element {
  const properties = {
    className: [styles["chip"], className].filter(Boolean).join(" "),
    "data-lifecycle-state": state.trim().toLocaleLowerCase("en"),
  };
  return href === undefined ? (
    <span {...properties}>{state}</span>
  ) : (
    <a {...properties} href={href}>
      {state}
    </a>
  );
}

export interface VisibilityChipProps {
  readonly className?: string | undefined;
  readonly href?: string | undefined;
  readonly visibility: string;
}

export function VisibilityChip({
  className,
  href,
  visibility,
}: VisibilityChipProps): React.JSX.Element {
  const properties = {
    className: [styles["chip"], className].filter(Boolean).join(" "),
    "data-document-visibility": visibility,
  };
  return href === undefined ? (
    <span {...properties}>{visibility}</span>
  ) : (
    <a {...properties} href={href}>
      {visibility}
    </a>
  );
}
