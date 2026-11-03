# Dependency and license audit

Captured 2026-11-03 from the current `package-lock.json` and npm registry advisories. This is a point-in-time check; rerun it after dependency changes.

## Vulnerabilities

- `npm audit --omit=dev`: **0 vulnerabilities** in the production dependency graph.
- Full `npm audit`: **10 development-tree findings** (2 low, 8 moderate; no high or critical findings). They are under the PWA build chain: `vite-plugin-pwa@1.3.0` → `workbox-build@7.4.1` → `deepmerge`, `glob`, `minimatch`, and the off-main-thread/ejs/jake/filelist chain.
- The registry's `npm audit fix --force` suggestion would move `vite-plugin-pwa` to `1.1.0`, outside the current `^1.2.0` range. That version's declared Vite peer range ends at Vite 7, while this workspace uses Vite 8.3.5. The latest plugin metadata still depends on Workbox 7.4.1, so blindly downgrading or overriding packages is not a verified fix. No forced dependency change was applied.

The flagged tree is used to build the service worker, not included in the production runtime install. Recheck when Workbox publishes a compatible patched dependency graph; then update the lockfile and rerun typecheck, tests and PWA build.

## License metadata

The lockfile contains 766 package entries. Eight have no SPDX `license` field: the private Shopro workspace package entries and `busboy`/`streamsearch`. The latter two package archives include the MIT permission text in their `LICENSE` files, but their manifests do not declare SPDX metadata. The private workspaces also do not declare a license.

The lockfile records 12 MPL-2.0 entries, one EPL-2.0 entry and one CC-BY-4.0 entry, in addition to MIT/ISC/Apache/BSD, BlueOak, OFL and other permissive entries. No project license allowlist or redistribution policy is present, so this inventory is not a legal approval. Confirm the workspace license and review the MPL/EPL/CC-BY obligations against the intended distribution model before release.
