import type { HTMLAttributes } from "react";

import { Text } from "@earendil-works/elanor-react";

import styles from "./form-error.module.css";

export interface FormErrorProps extends Omit<HTMLAttributes<HTMLParagraphElement>, "role"> {}

/** An error message for a form or action. Alerts are announced when they appear. */
export function FormError({
  children,
  className,
  ...props
}: FormErrorProps): React.JSX.Element | null {
  if (children === undefined || children === null || children === "") return null;
  return (
    <Text
      {...props}
      className={[styles["error"], className].filter(Boolean).join(" ")}
      role="alert"
    >
      {children}
    </Text>
  );
}
