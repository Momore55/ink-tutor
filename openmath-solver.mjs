import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

const core = new URL('./OpenMath/packages/math-core/src/index.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openmath/math-core') return nextResolve(core, context);
    if (context.parentURL?.includes('/OpenMath/packages/') && specifier.startsWith('.') && specifier.endsWith('.js')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { trySolve } = await import('./OpenMath/packages/steps/src/index.ts');
const expression = readFileSync(0, 'utf8').trim();
const result = trySolve(expression);
if (!result.ok || !result.solution.verified || result.solution.incomplete) {
  console.log(JSON.stringify({ error: 'OpenMath could not verify a complete solution for this expression.' }));
} else {
  const { problem, answer, steps } = result.solution;
  console.log(JSON.stringify({
    problem, answer,
    steps: steps.map(({ before, after, explanation }) => ({ before, after, explanation })),
  }));
}


