// Spec §13.2: no color literals in TS/TSX. Colors live only in tokens.css.
const COLOR_RE = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/;
export const noColorLiterals = {
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string' && COLOR_RE.test(node.value) && !/tokens\.css|ASSETS|contrast/i.test(context.filename)) {
          context.report({ message: 'Color literal outside tokens.css. Use a var(--token) from src/styles/tokens.css.', node });
        }
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          if (COLOR_RE.test(quasi.value.raw)) {
            context.report({ message: 'Color literal outside tokens.css. Use a var(--token) from src/styles/tokens.css.', node });
          }
        }
      },
    };
  },
  meta: { docs: { description: 'forbid color literals outside tokens.css' }, schema: [], type: 'problem' },
};
