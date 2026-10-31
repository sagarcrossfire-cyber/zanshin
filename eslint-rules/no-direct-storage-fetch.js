// Spec §13.2 / §6.2: screens never call fetch directly; only repositories touch IndexedDB;
// only importers/providers call fetch. This rule enforces the screen side of that boundary.
export const noDirectStorageFetch = {
  create(context) {
    const file = context.filename.replace(/\\/g, '/');
    const isScreen = /\/src\/(screens|components)\//.test(file);
    if (!isScreen) return {};
    return {
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          context.report({ message: 'Screens/components must not call fetch directly. Use a store/domain service.', node });
        }
      },
      Identifier(node) {
        if (node.name === 'indexedDB' && node.parent?.type !== 'MemberExpression') {
          context.report({ message: 'Screens/components must not touch indexedDB directly. Use a repository.', node });
        }
      },
      ImportDeclaration(node) {
        if (node.source.value === 'dexie' || node.source.value.endsWith('/db')) {
          context.report({ message: 'Screens/components must not import Dexie/db directly. Use a store/repository.', node });
        }
      },
    };
  },
  meta: { docs: { description: 'forbid direct fetch/indexedDB in screens and components' }, schema: [], type: 'problem' },
};
