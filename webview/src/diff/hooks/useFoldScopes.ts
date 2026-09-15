import { useCallback, useEffect, useState } from "react";
import { bridge } from "../../shared/bridge";
import type {
  DocumentSymbolNode,
  SymbolsResult,
} from "../../shared/bridge/types";
import type { FoldRegion, Side } from "../utils/diff-model";
import { enclosingSymbol, scopeLabel } from "../utils/symbols";

export interface FoldScopeOptions {
  /** The side whose outline names the folds, or null for none. */
  side: Side | null;
  /** How the host reads that side. */
  ref: string;
  path: string;
  /**
   * The text the outline should describe. A new value asks again; the last
   * answer stays up until the new one lands, so the badges do not blink out
   * on every save. Null asks for nothing.
   */
  version: string | null;
}

interface Outline {
  side: Side;
  ref: string;
  path: string;
  symbols: DocumentSymbolNode[];
}

/**
 * How long to wait before asking again after an empty outline. A language
 * server that is still starting answers with nothing, and the diff opens
 * at the same moment the server is asked to load the file; asking a few
 * more times, a little later each time, covers a cold start of most sizes
 * without asking forever of a document that simply has no symbols.
 */
export const OUTLINE_RETRY_DELAYS = [1500, 3000, 6000, 12000] as const;

/**
 * The scope badge on fold rows: the symbol a collapsed run starts inside,
 * from the host's document symbol provider, the way IntelliJ labels a fold
 * with the method it sits in. One outline per document version, looked up
 * per fold; a side no provider answers for gets no badges and the count
 * stands alone.
 */
export function useFoldScopes({
  side,
  ref,
  path,
  version,
}: FoldScopeOptions): (fold: FoldRegion) => string | null {
  const [outline, setOutline] = useState<Outline | null>(null);

  useEffect(() => {
    if (!side || version === null) return;
    let cancelled = false;
    let retry: number | null = null;
    const ask = (attempt: number) => {
      void bridge
        .request("languageQuery", { kind: "symbols", ref, path })
        .then((data) => {
          if (cancelled) return;
          const result = data as SymbolsResult | null;
          const symbols = result?.kind === "symbols" ? result.symbols : [];
          if (symbols.length === 0 && attempt < OUTLINE_RETRY_DELAYS.length) {
            retry = window.setTimeout(
              () => ask(attempt + 1),
              OUTLINE_RETRY_DELAYS[attempt],
            );
            return;
          }
          setOutline({ side, ref, path, symbols });
        })
        .catch(() => {
          // No outline is no badges, which is what the count alone means.
        });
    };
    ask(0);
    return () => {
      cancelled = true;
      if (retry !== null) window.clearTimeout(retry);
    };
  }, [side, ref, path, version]);

  // An outline for another document, or the other side of this one, names
  // nothing here: after a swap the texts have changed places under it.
  const usable =
    outline &&
    outline.side === side &&
    outline.ref === ref &&
    outline.path === path
      ? outline
      : null;

  return useCallback(
    (fold: FoldRegion) => {
      if (!usable) return null;
      const hidden = usable.side === "left" ? fold.left : fold.right;
      const symbol = enclosingSymbol(usable.symbols, hidden.start);
      return symbol ? scopeLabel(symbol) : null;
    },
    [usable],
  );
}
