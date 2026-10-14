import path from 'path';
import fs from 'fs/promises';
import { logger } from '@librechat/data-schemas';
import type { TPromoteFileResponse, TPromoteFileTarget } from 'librechat-data-provider';
import { getSafeErrorMetadata } from '~/utils/errors';

export interface FilePromotionConfig {
  exportsDir?: string;
  vaultStagingDir?: string;
  sandboxDir?: string;
  uploadsDir?: string;
}

export interface PromoteArtifactFileParams {
  userId: string;
  filename: string;
  target: TPromoteFileTarget;
  file_id?: string;
  content?: string;
  config?: FilePromotionConfig;
  getFiles?: (filter: { file_id: string; user: string }) => Promise<
    Array<{
      file_id?: string;
      user?: string;
      filepath?: string;
      filename?: string;
    }>
  >;
}

export type PromoteArtifactFileResult =
  | { ok: true; value: TPromoteFileResponse }
  | {
      ok: false;
      error: {
        code:
          | 'INVALID_TARGET'
          | 'INVALID_FILENAME'
          | 'PATH_TRAVERSAL_BLOCKED'
          | 'SOURCE_NOT_FOUND'
          | 'PROMOTION_FAILED';
        status: number;
        message: string;
      };
    };

const VALID_TARGETS = new Set<TPromoteFileTarget>(['exports', 'vault_staging']);

/**
 * Validates and sanitizes an artifact filename, rejecting any path traversal attempts.
 */
export function sanitizePromoteFilename(rawFilename: unknown):
  | {
      ok: true;
      filename: string;
    }
  | {
      ok: false;
      code: 'INVALID_FILENAME' | 'PATH_TRAVERSAL_BLOCKED';
      message: string;
    } {
  if (typeof rawFilename !== 'string') {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Filename must be a non-empty string.',
    };
  }

  const trimmed = rawFilename.trim();
  if (!trimmed || trimmed.includes('\0')) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Filename is empty or contains invalid characters.',
    };
  }

  const normalized = trimmed.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    normalized.includes('../') ||
    normalized.includes('/..') ||
    normalized === '..' ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return {
      ok: false,
      code: 'PATH_TRAVERSAL_BLOCKED',
      message: 'Path traversal sequences and absolute paths are not allowed.',
    };
  }

  const base = path.posix.basename(normalized);
  if (!base || base === '.' || base === '..' || base !== normalized) {
    return {
      ok: false,
      code: 'PATH_TRAVERSAL_BLOCKED',
      message: 'Filename must not contain directory separators.',
    };
  }

  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x80-\x9f<>:"|?*]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 255);

  if (!cleaned) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Filename is invalid after sanitization.',
    };
  }

  return { ok: true, filename: cleaned };
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    path.dirname(resolvedCandidate) === resolvedRoot
  );
}

async function hardlinkOrCopyFile(
  sourcePath: string,
  destPath: string,
): Promise<'hardlink' | 'copy'> {
  try {
    await fs.unlink(destPath).catch(() => undefined);
    await fs.link(sourcePath, destPath);
    return 'hardlink';
  } catch {
    await fs.copyFile(sourcePath, destPath);
    return 'copy';
  }
}

async function isRegularNonSymlinkFile(filePath: string): Promise<boolean> {
  try {
    const lstat = await fs.lstat(filePath);
    return lstat.isFile() && !lstat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Promotes an artifact or sandbox output file into `/app/exports/` or `/app/vault/staging/`.
 */
export async function promoteArtifactFile(
  params: PromoteArtifactFileParams,
): Promise<PromoteArtifactFileResult> {
  const { userId, filename: rawFilename, target, file_id, content, config, getFiles } = params;

  if (!VALID_TARGETS.has(target)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TARGET',
        status: 400,
        message: 'Invalid promotion target. Expected "exports" or "vault_staging".',
      },
    };
  }

  const sanitized = sanitizePromoteFilename(rawFilename);
  if (!sanitized.ok) {
    return {
      ok: false,
      error: {
        code: sanitized.code,
        status: 400,
        message: sanitized.message,
      },
    };
  }

  const safeFilename = sanitized.filename;
  const exportsDir = config?.exportsDir || process.env.PROMOTE_EXPORTS_DIR || '/app/exports';
  const vaultStagingDir =
    config?.vaultStagingDir || process.env.PROMOTE_VAULT_STAGING_DIR || '/app/vault/staging';
  const sandboxDir = config?.sandboxDir || process.env.PROMOTE_SANDBOX_DIR || '/mnt/data';

  const configuredTargetDir = target === 'exports' ? exportsDir : vaultStagingDir;
  const destRoot = path.resolve(configuredTargetDir);
  const destPath = path.resolve(destRoot, safeFilename);

  if (!isWithinRoot(destPath, destRoot)) {
    return {
      ok: false,
      error: {
        code: 'PATH_TRAVERSAL_BLOCKED',
        status: 400,
        message: 'Resolved destination path escaped target directory.',
      },
    };
  }

  try {
    await fs.mkdir(destRoot, { recursive: true });
  } catch (err) {
    logger.error(
      '[promoteArtifactFile] Failed to create target directory',
      getSafeErrorMetadata(err),
    );
    return {
      ok: false,
      error: {
        code: 'PROMOTION_FAILED',
        status: 500,
        message: 'Failed to prepare destination directory.',
      },
    };
  }

  let sourceFilePath: string | null = null;

  if (typeof file_id === 'string' && file_id.trim().length > 0 && getFiles) {
    try {
      const files = await getFiles({ file_id: file_id.trim(), user: userId });
      const fileDoc = files?.[0];
      if (fileDoc?.filepath && typeof fileDoc.filepath === 'string') {
        const uploadsRoot = config?.uploadsDir ? path.resolve(config.uploadsDir) : null;
        let candidate: string | null = null;
        if (path.isAbsolute(fileDoc.filepath)) {
          candidate = path.resolve(fileDoc.filepath);
        } else if (uploadsRoot) {
          candidate = path.resolve(uploadsRoot, fileDoc.filepath.replace(/^\/+/, ''));
        }
        if (candidate && (await isRegularNonSymlinkFile(candidate))) {
          sourceFilePath = candidate;
        }
      }
    } catch (err) {
      logger.warn('[promoteArtifactFile] Failed to look up file_id', getSafeErrorMetadata(err));
    }
  }

  if (!sourceFilePath) {
    const sandboxRoot = path.resolve(sandboxDir);
    const sandboxCandidate = path.resolve(sandboxRoot, safeFilename);
    if (
      isWithinRoot(sandboxCandidate, sandboxRoot) &&
      (await isRegularNonSymlinkFile(sandboxCandidate))
    ) {
      sourceFilePath = sandboxCandidate;
    }
  }

  try {
    if (sourceFilePath) {
      await hardlinkOrCopyFile(sourceFilePath, destPath);
    } else if (typeof content === 'string') {
      await fs.writeFile(destPath, content, 'utf8');
    } else {
      return {
        ok: false,
        error: {
          code: 'SOURCE_NOT_FOUND',
          status: 404,
          message: 'Source artifact file not found in sandbox or storage.',
        },
      };
    }

    await fs.stat(destPath);
    const displayPath = configuredTargetDir.startsWith('/')
      ? path.posix.join(configuredTargetDir.replace(/\\/g, '/'), safeFilename)
      : destPath;

    return {
      ok: true,
      value: {
        ok: true,
        filename: safeFilename,
        target,
        destinationPath: displayPath,
      },
    };
  } catch (err) {
    logger.error('[promoteArtifactFile] Failed to promote file', getSafeErrorMetadata(err));
    return {
      ok: false,
      error: {
        code: 'PROMOTION_FAILED',
        status: 500,
        message: 'Failed to promote artifact file to destination.',
      },
    };
  }
}

export async function handlePromoteFileRequest(
  req: {
    user?: { id?: string };
    config?: {
      paths?: { uploads?: string };
      filePromotion?: FilePromotionConfig;
    };
    body?: {
      filename?: unknown;
      target?: unknown;
      file_id?: unknown;
      content?: unknown;
    };
  },
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  deps: {
    getFiles?: PromoteArtifactFileParams['getFiles'];
  } = {},
): Promise<void> {
  const userId = req.user?.id ?? '';
  const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
  const target = req.body?.target as TPromoteFileTarget;
  const file_id = typeof req.body?.file_id === 'string' ? req.body.file_id : undefined;
  const content = typeof req.body?.content === 'string' ? req.body.content : undefined;

  const result = await promoteArtifactFile({
    userId,
    filename,
    target,
    file_id,
    content,
    config: {
      ...req.config?.filePromotion,
      uploadsDir: req.config?.paths?.uploads,
    },
    getFiles: deps.getFiles,
  });

  if (!result.ok) {
    res.status(result.error.status).json({
      error: result.error.message,
      code: result.error.code,
    });
    return;
  }

  res.status(200).json(result.value);
}
