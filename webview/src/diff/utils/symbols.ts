import type { DocumentSymbolNode } from "../../shared/bridge/types";

/**
 * The innermost symbol whose range covers `line`: the scope a fold row names,
 * the way IntelliJ labels a collapsed run with the method it sits in. A tree
 * from a DocumentSymbol provider is walked into its children; a flat list
 * from a SymbolInformation provider is covered by the same containment
 * test, since the smallest covering range wins either way.
 */
export function enclosingSymbol(
  symbols: readonly DocumentSymbolNode[],
  line: number,
): DocumentSymbolNode | null {
  let best: DocumentSymbolNode | null = null;
  const visit = (nodes: readonly DocumentSymbolNode[]) => {
    for (const node of nodes) {
      const { start, end } = node.range;
      if (line < start.line || line > end.line) continue;
      if (!best || span(node) <= span(best)) best = node;
      visit(node.children);
    }
  };
  visit(symbols);
  return best;
}

function span(node: DocumentSymbolNode): number {
  return node.range.end.line - node.range.start.line;
}

/**
 * `vscode.SymbolKind` values whose symbols are called: a function, a method,
 * a constructor. Their scope reads with parentheses after the name, as it
 * does in an IDE's breadcrumbs; everything else is a name alone.
 */
const CALLABLE_KINDS: ReadonlySet<number> = new Set([5, 8, 11]);

/** How a scope badge spells a symbol. */
export function scopeLabel(symbol: DocumentSymbolNode): string {
  return CALLABLE_KINDS.has(symbol.kind) ? `${symbol.name}()` : symbol.name;
}
