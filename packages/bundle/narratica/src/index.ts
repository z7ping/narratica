/**
 * Host half for the formal Narratica entry package.
 *
 * The actual Host capabilities are mounted by cordis.patch.yml through
 * @narratica/narratica/runtime/* bridge modules. This no-op root plugin exists
 * so the same top-level package can also be a DSH Client plugin loader row.
 */
export function apply(): void {}
