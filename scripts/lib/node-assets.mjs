// Lets Node scripts (rail-check) import the game's data modules, which import assets the Vite way ("x.glb?url"):
// those resolve to a plain string export instead.
//   node --import ./scripts/lib/node-assets.mjs scripts/rail-check.js
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.endsWith('?url')) return { url: 'data:text/javascript,export default ' + JSON.stringify(spec), shortCircuit: true };
  return next(spec, ctx);
}`),
);
