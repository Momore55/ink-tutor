/* Convert input notation into positioned pen strokes. Coordinates use one glyph cell. */
globalThis.layoutBoardMath = function layoutBoardMath(source) {
  const text = source.replaceAll('−', '-').replaceAll('²', '^2').replaceAll('³', '^3')
    .replace(/\\(?:left|right)\b/g, '').replace(/\\(?:cdot|times)\b/g, '×')
    .replace(/\\theta\b/g, 'θ').replace(/\\pi\b/g, 'π')
    .replace(/\\(?:quad|qquad)\b|\\[,;! ]/g, ' ')
    .replace(/\\leq?\b/g, '≤').replace(/\\geq?\b/g, '≥');
  if (!text.trim() || text.length > 240) throw new Error('Use a shorter math line.');
  let position = 0;
  const box = (width, marks) => ({ width, marks });
  const glyph = char => box(char === ' ' ? 0.45 : 1, [{ char, x: 0, y: 0, scale: 1 }]);
  const shift = (part, x, y, scale = 1) => part.marks.map(mark => ({
    ...mark, x: x + mark.x * scale, y: y + mark.y * scale, scale: mark.scale * scale,
  }));
  const join = parts => parts.reduce((a, b) => box(a.width + b.width, [...a.marks, ...shift(b, a.width, 0)]), box(0, []));
  function fraction(top, bottom) {
    const width = Math.max(top.width, bottom.width) * 0.72 + 0.35;
    return box(width, [
      ...shift(top, (width - top.width * 0.72) / 2, -0.64, 0.72),
      { char: 'bar', x: 0, y: 0, scale: 1, width },
      ...shift(bottom, (width - bottom.width * 0.72) / 2, 0.58, 0.72),
    ]);
  }
  function atom() {
    const token = text.slice(position).match(/^(?:\\[a-z]+|[0-9]+(?:\.[0-9]+)?|.)/)?.[0];
    if (!token) throw new Error('Missing math operand.');
    position += token.length;
    if (token === '{' || token === '(' || token === '[') {
      const end = { '{': '}', '(': ')', '[': ']' }[token];
      const inner = sequence(end);
      if (text[position++] !== end) throw new Error('Unclosed math group.');
      return token === '{' ? inner : join([glyph(token), inner, glyph(end)]);
    }
    if (token === '\\frac') return fraction(atom(), atom());
    if (token === '\\sqrt') return join([glyph('√'), atom()]);
    if (token === '\\sum' || token === 'Σ' || token === '∑') return glyph('∑');
    if (!/^[0-9a-zA-Z+*=.,:;· ×÷√θπ%<>≤≥-]+$/.test(token)) throw new Error('Unsupported math notation.');
    return { ...join(Array.from(token, glyph)), adjacent: /^[0-9a-zA-Z.]+$/.test(token) };
  }
  function term() {
    const base = atom();
    let upper, lower;
    while (text[position] === '^' || text[position] === '_') {
      const kind = text[position++];
      const script = atom();
      if (kind === '^') upper = script;
      else lower = script;
    }
    if (!upper && !lower) return base;
    const size = 0.56;
    const stacked = base.marks.length === 1 && base.marks[0].char === '∑';
    const scripts = Math.max(upper?.width || 0, lower?.width || 0) * size;
    const width = stacked ? Math.max(base.width, scripts) : base.width + scripts;
    const marks = shift(base, stacked ? (width - base.width) / 2 : 0, 0);
    if (upper) marks.push(...shift(upper, stacked ? (width - upper.width * size) / 2 : base.width, -0.58, size));
    if (lower) marks.push(...shift(lower, stacked ? (width - lower.width * size) / 2 : base.width, 0.62, size));
    return { ...box(width, marks), adjacent: base.adjacent };
  }
  function sequence(end) {
    const parts = [];
    while (position < text.length && text[position] !== end) {
      if (text[position] !== '/') {
        parts.push(term());
        continue;
      }
      position++;
      while (parts.at(-1)?.marks[0]?.char === ' ') parts.pop();
      const last = parts.pop();
      while (text[position] === ' ') position++;
      if (!last) throw new Error('Missing fraction numerator.');
      const numerator = [last];
      if (last.adjacent) {
        while (parts.at(-1)?.adjacent) numerator.unshift(parts.pop());
      }
      const denominator = [term()];
      if (denominator[0].adjacent) {
        while (/^[0-9a-zA-Z]/.test(text.slice(position))) denominator.push(term());
      }
      parts.push(fraction(join(numerator), join(denominator)));
    }
    return join(parts);
  }
  return sequence();
};
