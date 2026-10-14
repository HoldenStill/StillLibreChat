# One-Click Artifact Promotion & Vault Staging

This document explains the server-side file promotion route (`POST /api/files/promote`), path-traversal protections, Docker/ZFS volume layout, and UI integration for promoting artifacts and generated files.

---

## 1. Overview

Artifacts generated in chat (`:::artifact` blocks) or files produced by the Code Interpreter / sandbox environment can be promoted with a single click into persistent host/ZFS directories:
- **Save to Exports** (`target: 'exports'`) → `/app/exports/<filename>`
- **Stage to Vault** (`target: 'vault_staging'`) → `/app/vault/staging/<filename>`

---

## 2. Backend Route & Security (`packages/api/src/files/promote.ts`)

### 2.1 Endpoint Contract
- **Route**: `POST /api/files/promote`
- **Authentication**: `requireJwtAuth`
- **Request Body (`TPromoteFileRequest`)**:
  ```json
  {
    "filename": "sensor_telemetry.csv",
    "target": "exports",
    "file_id": "optional-file-uuid",
    "content": "optional inline artifact text"
  }
  ```
- **Response Body (`TPromoteFileResponse`)**:
  ```json
  {
    "ok": true,
    "destinationPath": "/app/exports/sensor_telemetry.csv",
    "filename": "sensor_telemetry.csv",
    "target": "exports"
  }
  ```

### 2.2 Source Resolution Order
1. **Database File Record (`file_id`)**: Looks up the user-owned file via `getFiles({ file_id }, null, { user: req.user.id })` and resolves its local storage path inside `paths.uploads` or `paths.publicPath`.
2. **Sandbox Shared Output Directory**: Searches `/mnt/data/<filename>` (or `SANDBOX_DATA_DIR`).
3. **Inline Artifact Content (`content`)**: Writes the inline artifact buffer directly to the destination file when the artifact is model-authored rather than backed by a pre-existing disk file.

### 2.3 Path-Traversal Sanitization & Copy/Hardlink Strategy
- `sanitizePromoteFilename(rawFilename)` strips directory prefixes via `path.posix.basename`, removes null bytes and control characters, and rejects `.` and `..`.
- `resolveSafeChildPath(baseDir, basename)` verifies with `path.relative(resolvedBase, resolvedTarget)` that the destination cannot escape the target directory.
- For existing local/sandbox files, `copyOrLinkFile` attempts an atomic `fs.promises.link` (hardlink) first for zero-copy ZFS/filesystem performance, falling back to `fs.promises.copyFile` across mount boundaries (`EXDEV`).

---

## 3. Docker & Host ZFS Volume Mapping

No changes to the upstream `Dockerfile` or port bindings (`3080:3080`) are required. To persist promoted files onto host ZFS datasets, mount `/app/exports` and `/app/vault/staging` in your `docker-compose.override.yml`:

```yaml
services:
  api:
    volumes:
      - /tank/exports:/app/exports
      - /tank/vault/staging:/app/vault/staging
      - /tank/sandbox/data:/mnt/data:ro
```
*(Optional environment overrides `PROMOTE_EXPORTS_DIR`, `PROMOTE_VAULT_STAGING_DIR`, and `SANDBOX_DATA_DIR` are also supported for non-containerized development.)*

---

## 4. Frontend Integration (`PromoteArtifactMenu.tsx`)

The **Promote / Stage Artifact** action menu (`FolderOutput` icon button using `@librechat/client`'s `DropdownPopup` + `Ariakit.MenuButton`) appears on:
1. **Artifacts Side Panel Header** (`client/src/components/Artifacts/Artifacts.tsx`), beside the Download button.
2. **Inline Artifact Rows** (`client/src/components/Chat/Messages/Content/Parts/ArtifactRow.tsx`).
3. **Generated File Attachments** (`client/src/components/Chat/Messages/Content/Parts/Attachment.tsx`).

Selecting **Save to Exports** or **Stage to Vault** triggers the promotion mutation and displays a toast notification confirming the exact destination path (e.g., `Artifact saved to /app/exports/sensor_telemetry.csv`).
