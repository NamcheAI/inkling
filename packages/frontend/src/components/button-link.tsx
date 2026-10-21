import { Button } from "@earendil-works/elanor-react";
import type { ButtonProps } from "@earendil-works/elanor-react";

export interface ButtonLinkProps extends Omit<ButtonProps, "nativeButton" | "render" | "type"> {
  readonly href: string;
}

/**
 * An Elanor button that navigates. Base UI marks non-button elements as `role="button"`;
 * navigation keeps the anchor's link role so it reads and behaves as a link.
 */
export function ButtonLink({ href, ...props }: ButtonLinkProps): React.JSX.Element {
  return <Button {...props} nativeButton={false} render={<a href={href} />} role="link" />;
}
