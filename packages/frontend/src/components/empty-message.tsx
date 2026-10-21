import type { ComponentType, HTMLAttributes, ReactNode } from "react";

import { EmptyState } from "@earendil-works/elanor-react";

import styles from "./empty-message.module.css";

export interface EmptyMessageProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "className" | "title"
> {
  readonly description: ReactNode;
  /** A short warning above the title, such as "In Trash". */
  readonly warning?: ReactNode;
  readonly icon: ComponentType<{ readonly className?: string | undefined }>;
  readonly level: 1 | 2;
  readonly title: ReactNode;
}

/** Elanor's empty state with an icon illustration, for empty lists and unavailable documents. */
export function EmptyMessage({
  description,
  warning,
  icon: Icon,
  level,
  title,
  ...props
}: EmptyMessageProps): React.JSX.Element {
  return (
    <EmptyState.Root {...props} className={styles["root"]} data-empty-state="">
      <EmptyState.Illustration>
        <Icon className={styles["illustration"]} />
      </EmptyState.Illustration>
      <EmptyState.Body>
        <EmptyState.Copy>
          {warning === undefined ? null : <p className={styles["warning"]}>{warning}</p>}
          <EmptyState.Title level={level}>{title}</EmptyState.Title>
          <EmptyState.Description>{description}</EmptyState.Description>
        </EmptyState.Copy>
      </EmptyState.Body>
    </EmptyState.Root>
  );
}
