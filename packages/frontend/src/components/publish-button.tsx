import { Effect } from "effect";

import { PublishIcon } from "@earendil-works/elanor-icons-react";
import { Button } from "@earendil-works/elanor-react";
import { hasPendingPublicationChanges } from "@earendil-works/inkling-core";
import type { DocumentMetadataDto } from "@earendil-works/inkling-protocol";

import type { ApiClientService, ApiError } from "../api.ts";
import type { CollaborationClientError } from "../collaboration.ts";
import { useAppContext } from "../app-context.tsx";
import { useEffectAction } from "../effect-hooks.ts";

export interface PublishButtonProps {
  readonly api: ApiClientService;
  readonly beforePublish: () => Effect.Effect<void, CollaborationClientError>;
  readonly disabled?: boolean | undefined;
  readonly disabledLabel?: string | undefined;
  readonly metadata: DocumentMetadataDto;
  readonly onPublished: (metadata: DocumentMetadataDto) => void;
  readonly published: boolean;
}

export function PublishButton({
  api,
  beforePublish,
  disabled = false,
  disabledLabel,
  metadata,
  onPublished,
  published,
}: PublishButtonProps): React.JSX.Element {
  const { showToast } = useAppContext();
  const publish = useEffectAction<
    undefined,
    DocumentMetadataDto,
    ApiError | CollaborationClientError
  >(() => beforePublish().pipe(Effect.zipRight(api.publish(metadata.id))));
  const label = published && hasPendingPublicationChanges(metadata) ? "Publish Changes" : "Publish";

  return (
    <Button
      data-publish=""
      disabled={disabled}
      iconStart={<PublishIcon />}
      pending={publish.state.pending}
      onClick={() =>
        publish.execute(undefined, {
          onFailure: (error) => showToast(error.message, "error"),
          onSuccess: (nextMetadata) => {
            onPublished(nextMetadata);
            showToast("Revision published.", "success");
          },
        })
      }
    >
      {publish.state.pending ? "Saving & publishing…" : (disabledLabel ?? label)}
    </Button>
  );
}
