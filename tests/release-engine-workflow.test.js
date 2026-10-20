import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workflow = Bun.YAML.parse(readFileSync(new URL('../.github/workflows/release-engine.yml', import.meta.url), 'utf8'));
const action = (job, name) => job.steps.find(step => step.uses?.startsWith(`${name}@`));

describe('engine release boundary', () => {
  test('no job receives an OIDC token; only publish can write', () => {
    expect(workflow.on).toEqual({ push: { tags: ['engine-v*'] } });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions?.['id-token']).toBeUndefined();
    }
    expect(workflow.jobs.publish.permissions).toEqual({ contents: 'write' });
  });

  test('the fork ships no Windows binary: it has no signing account for one', () => {
    const targets = workflow.jobs.build.strategy.matrix.include.map(entry => entry.short);
    expect(targets).toEqual(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']);
    expect(Object.keys(workflow.jobs)).toEqual(['build', 'publish']);
    expect(workflow.jobs.publish.needs).toEqual(['build']);
  });

  test('publication collects exactly the build artifacts, with checksums', () => {
    expect(action(workflow.jobs.build, 'actions/upload-artifact').with.name).toBe('impeccable-${{ matrix.short }}');
    expect(action(workflow.jobs.publish, 'actions/download-artifact').with.pattern).toBe('impeccable-*');
    expect(workflow.jobs.publish.steps.find(step => step.name === 'Lay out release assets with checksums').run).toContain('sha256sum');
  });

  test('artifact downloads stay on the same-run runtime-token path', () => {
    const download = action(workflow.jobs.publish, 'actions/download-artifact');
    // Supplying github-token opts into the public API path, which requires
    // separate Actions permissions and can read other workflow runs.
    for (const input of ['github-token', 'repository', 'run-id']) {
      expect(download.with[input]).toBeUndefined();
    }
  });

  test('every third-party action is pinned to a commit', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });
});
