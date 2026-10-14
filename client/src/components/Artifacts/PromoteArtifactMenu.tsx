import React, { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Archive, FolderOutput, LoaderCircle } from 'lucide-react';
import { DropdownPopup, TooltipAnchor, useToastContext } from '@librechat/client';
import type { TPromoteFileTarget } from 'librechat-data-provider';
import type { Artifact, MenuItemProps } from '~/common';
import { getArtifactDownloadFilename, getOriginalArtifactFilename } from '~/utils/artifacts';
import { usePromoteFileMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export interface PromoteArtifactMenuProps {
  artifact?: Artifact;
  filename?: string;
  fileId?: string;
  content?: string;
  portalElement?: HTMLElement | null;
  buttonClassName?: string;
}

function resolvePromoteFilename(
  artifact?: Artifact,
  explicitFilename?: string,
  explicitContent?: string,
): string {
  if (explicitFilename && explicitFilename.trim().length > 0) {
    return explicitFilename.trim();
  }
  if (!artifact) {
    return 'artifact.txt';
  }
  const fallbackBase = artifact.title?.trim() || artifact.identifier?.trim() || 'artifact';
  if (artifact.download?.filename) {
    return getOriginalArtifactFilename(artifact, fallbackBase);
  }
  return getArtifactDownloadFilename(
    artifact,
    fallbackBase,
    explicitContent ?? artifact.content ?? '',
  );
}

const PromoteArtifactMenu = memo(function PromoteArtifactMenu({
  artifact,
  filename: explicitFilename,
  fileId: explicitFileId,
  content: explicitContent,
  portalElement,
  buttonClassName,
}: PromoteArtifactMenuProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const promoteMutation = usePromoteFileMutation();

  const resolvedFilename = useMemo(
    () => resolvePromoteFilename(artifact, explicitFilename, explicitContent),
    [artifact, explicitContent, explicitFilename],
  );
  const resolvedFileId = explicitFileId ?? artifact?.download?.file_id;
  const resolvedContent = explicitContent ?? artifact?.content;

  const handlePromote = useCallback(
    (target: TPromoteFileTarget) => {
      promoteMutation.mutate(
        {
          filename: resolvedFilename,
          target,
          file_id: resolvedFileId,
          content: resolvedContent,
        },
        {
          onSuccess: (data) => {
            showToast({
              status: 'success',
              message: localize('com_ui_promote_artifact_success', {
                0: data.destinationPath,
              }),
            });
          },
          onError: () => {
            showToast({
              status: 'error',
              message: localize('com_ui_promote_artifact_error'),
            });
          },
        },
      );
    },
    [localize, promoteMutation, resolvedContent, resolvedFileId, resolvedFilename, showToast],
  );

  const isBusy = promoteMutation.isLoading;

  const items = useMemo<MenuItemProps[]>(
    () => [
      {
        id: 'promote-save-to-exports',
        label: localize('com_ui_promote_save_to_exports'),
        disabled: isBusy,
        icon: <FolderOutput className="text-text-secondary size-4" />,
        onClick: () => handlePromote('exports'),
      },
      {
        id: 'promote-stage-to-vault',
        label: localize('com_ui_promote_stage_to_vault'),
        disabled: isBusy,
        icon: <Archive className="text-text-secondary size-4" />,
        onClick: () => handlePromote('vault_staging'),
      },
    ],
    [handlePromote, isBusy, localize],
  );

  const triggerLabel = localize('com_ui_promote_artifact');

  return (
    <DropdownPopup
      portal
      focusLoop
      unmountOnHide
      menuId={menuId}
      finalFocus={triggerRef}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      items={items}
      portalElement={portalElement}
      minWidth="13rem"
      trigger={
        <TooltipAnchor
          portalElement={portalElement}
          description={triggerLabel}
          render={
            <Ariakit.MenuButton
              ref={triggerRef}
              data-testid="promote-artifact-menu-button"
              aria-label={triggerLabel}
              aria-busy={isBusy || undefined}
              disabled={isBusy}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                'focus-visible:outline-focus-subtle flex items-center justify-center rounded-lg p-1.5 transition-colors focus-visible:outline focus-visible:outline-2',
                buttonClassName,
              )}
            >
              {isBusy ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <FolderOutput className="size-4" aria-hidden="true" />
              )}
            </Ariakit.MenuButton>
          }
        />
      }
    />
  );
});

PromoteArtifactMenu.displayName = 'PromoteArtifactMenu';

export default PromoteArtifactMenu;
