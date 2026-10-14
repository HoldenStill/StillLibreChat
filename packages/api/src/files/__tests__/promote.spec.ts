import fs from 'fs';
import os from 'os';
import path from 'path';
import { promoteArtifactFile, sanitizePromoteFilename } from '../promote';

describe('Artifact File Promotion & Path Sanitization (Feature 3)', () => {
  it('sanitizes filenames and rejects path traversal attempts', () => {
    expect(sanitizePromoteFilename('telemetry_2026.csv')).toEqual({
      ok: true,
      filename: 'telemetry_2026.csv',
    });
    expect(sanitizePromoteFilename('/mnt/data/output/wave.svg').ok).toBe(false);
    expect(sanitizePromoteFilename('..\\..\\etc\\passwd').ok).toBe(false);
    expect(sanitizePromoteFilename('..').ok).toBe(false);
    expect(sanitizePromoteFilename('.').ok).toBe(false);
    expect(sanitizePromoteFilename('').ok).toBe(false);
  });

  it('promotes content and sandbox files into exports and vault_staging safely', async () => {
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'librechat-promote-test-'));
    const sandboxDir = path.join(tmpRoot, 'sandbox');
    const exportsDir = path.join(tmpRoot, 'exports');
    const vaultDir = path.join(tmpRoot, 'vault', 'staging');
    await fs.promises.mkdir(sandboxDir, { recursive: true });

    const sampleFile = path.join(sandboxDir, 'sensor_dump.csv');
    await fs.promises.writeFile(sampleFile, 'time,vcc\n0,3.3\n1,3.31\n', 'utf8');

    try {
      const res1 = await promoteArtifactFile({
        userId: 'user-123',
        filename: 'sensor_dump.csv',
        target: 'exports',
        config: {
          exportsDir,
          vaultStagingDir: vaultDir,
          sandboxDir,
        },
      });

      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value.filename).toBe('sensor_dump.csv');
        const copied = await fs.promises.readFile(path.join(exportsDir, 'sensor_dump.csv'), 'utf8');
        expect(copied).toContain('3.31');
      }

      const res2 = await promoteArtifactFile({
        userId: 'user-123',
        filename: 'bus_timing.wavejson',
        target: 'vault_staging',
        content: '{ "signal": [{ "name": "clk", "wave": "p...." }] }',
        config: {
          exportsDir,
          vaultStagingDir: vaultDir,
          sandboxDir,
        },
      });

      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.filename).toBe('bus_timing.wavejson');
        const staged = await fs.promises.readFile(
          path.join(vaultDir, 'bus_timing.wavejson'),
          'utf8',
        );
        expect(staged).toContain('p....');
      }
    } finally {
      await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
