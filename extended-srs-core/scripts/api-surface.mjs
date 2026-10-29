// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import ts from 'typescript';
import path from 'node:path';

/** Record exported types and public members, rather than implementation text. */
export function apiSurface(root, entry) {
  root = path.resolve(root);
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const filename = path.join(root, entry);
  const program = ts.createProgram([filename], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(filename);
  const module = checker.getSymbolAtLocation(source);
  const normalize = (text) =>
    text
      .replaceAll(root.replaceAll('\\', '/'), '<package>')
      .replace(/import\("[^"]*\/node_modules\/([^"]+)"\)/g, 'import("$1")')
      .replace(/(__@\w+)@\d+/g, '$1');
  const describe = (type, expandAlias = false) =>
    normalize(
      checker.typeToString(
        type,
        undefined,
        ts.TypeFormatFlags.NoTruncation |
          ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
          (expandAlias ? ts.TypeFormatFlags.InTypeAlias : 0),
      ),
    );
  const result = {};
  for (let symbol of checker
    .getExportsOfModule(module)
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const name = symbol.name;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const declaration = symbol.valueDeclaration ?? symbol.declarations[0];
    const type =
      symbol.flags & ts.SymbolFlags.Type
        ? checker.getDeclaredTypeOfSymbol(symbol)
        : checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const members = {};
    if (
      symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class) ||
      (symbol.flags & ts.SymbolFlags.TypeAlias && type.flags & ts.TypeFlags.Object)
    ) {
      for (const member of type.getProperties().sort((a, b) => a.name.localeCompare(b.name))) {
        const location = member.valueDeclaration ?? member.declarations?.[0] ?? declaration;
        if (
          ts.getCombinedModifierFlags(location) &
          (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
        ) {
          continue;
        }
        members[normalize(member.name)] = {
          optional: !!(member.flags & ts.SymbolFlags.Optional),
          readonly: !!(ts.getCombinedModifierFlags(location) & ts.ModifierFlags.Readonly),
          type: describe(checker.getTypeOfSymbolAtLocation(member, location)),
        };
      }
    }
    const constructors =
      symbol.flags & ts.SymbolFlags.Class
        ? checker
            .getTypeOfSymbolAtLocation(symbol, declaration)
            .getConstructSignatures()
            .map((signature) =>
              normalize(
                checker.signatureToString(signature, undefined, ts.TypeFormatFlags.NoTruncation),
              ),
            )
        : [];
    const constants = {};
    if (symbol.flags & ts.SymbolFlags.Enum) {
      for (const member of symbol.exports.values()) {
        constants[member.name] = checker.getConstantValue(member.declarations[0]);
      }
    }
    result[name] = {
      type: describe(type, !!(symbol.flags & ts.SymbolFlags.TypeAlias)),
      members,
      constructors,
      constants,
    };
  }
  return result;
}
