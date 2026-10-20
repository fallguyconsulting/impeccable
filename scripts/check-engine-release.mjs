#!/usr/bin/env node
/**
 * Release-order guard (triage decision D4).
 *
 * The launcher (skill/scripts/impeccable), the npm shim (cli/bin/cli.js), and
 * `impeccable install` all dead-end unless the engine release for the pinned
 * ENGINE_VERSION exists FIRST. This fork publishes only the GitHub Release
 * engine-v<version> with the macOS and Linux binaries (RELEASED_TARGETS); it
 * publishes no npm platform packages and no Windows binary.
 *
 * This script verifies, for the pinned engine version, that:
 *   1. each released binary impeccable-<os>-<arch> is fetchable
 *   2. each binary's .sha256 sidecar is fetchable
 *
 * Exits 0 when everything is present, non-zero (naming exactly what is missing)
 * otherwise. release.mjs runs it before an engine-dependent release; CI runs it
 * as a soft warning until the first engine release exists.
 *
 *   node scripts/check-engine-release.mjs            # check the pinned ENGINE_VERSION
 *   node scripts/check-engine-release.mjs --json     # machine-readable report
 *
 * Environment:
 *   IMPECCABLE_DOWNLOAD_BASE  release root (default: this fork's GitHub Releases)
 */
import {
  RELEASED_TARGETS,
  DEFAULT_DOWNLOAD_BASE,
  readEngineVersion,
  assetUrl,
} from './fetch-engine.mjs';

// A ranged GET is the most portable existence probe: GitHub release downloads
// answer HEAD inconsistently across their 302 to object storage, but a
// `Range: bytes=0-0` GET follows the redirect and returns 200/206 for a real
// asset and 404 for a missing one without pulling the whole binary.
async function urlExists(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { Range: 'bytes=0-0' } });
    return res.ok || res.status === 206;
  } catch (err) {
    return false;
  }
}

/**
 * Check every asset for one engine version. Returns { ok, version, base, missing }
 * where missing is a list of { kind, target, what, url } entries.
 */
export async function checkEngineRelease({
  version = readEngineVersion(),
  base = process.env.IMPECCABLE_DOWNLOAD_BASE || DEFAULT_DOWNLOAD_BASE,
} = {}) {
  const missing = [];

  await Promise.all(
    RELEASED_TARGETS.map(async (target) => {
      const binUrl = assetUrl(version, target, base);
      const shaUrl = `${binUrl}.sha256`;

      const [binOk, shaOk] = await Promise.all([urlExists(binUrl), urlExists(shaUrl)]);

      if (!binOk) missing.push({ kind: 'binary', target, what: `impeccable-${target} binary`, url: binUrl });
      if (!shaOk) missing.push({ kind: 'checksum', target, what: `impeccable-${target} .sha256`, url: shaUrl });
    })
  );

  // Stable ordering for a readable report: by target, then binary/checksum.
  const order = { binary: 0, checksum: 1 };
  missing.sort((a, b) => RELEASED_TARGETS.indexOf(a.target) - RELEASED_TARGETS.indexOf(b.target) || order[a.kind] - order[b.kind]);

  return { ok: missing.length === 0, version, base, missing };
}

function report(result) {
  const { ok, version, base, missing } = result;
  if (ok) {
    console.log(`✓ engine v${version} release is complete: all ${RELEASED_TARGETS.length} binaries + .sha256 are published.`);
    console.log(`  release base: ${base}`);
    return;
  }
  console.error(`✗ engine v${version} release is INCOMPLETE — ${missing.length} asset(s) missing:`);
  for (const m of missing) {
    console.error(`  · ${m.what}`);
    console.error(`      ${m.url}`);
  }
  console.error('');
  console.error(`Publish engine v${version} (push tag engine-v${version}) BEFORE releasing the skill`);
  console.error('or merging a new ENGINE_VERSION to main.');
  console.error(`  release base: ${base}`);
}

async function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const result = await checkEngineRelease();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    report(result);
  }
  return result.ok ? 0 : 1;
}

// Run only when invoked directly, not when imported by release.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
