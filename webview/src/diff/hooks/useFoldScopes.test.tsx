import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("../../shared/bridge", () => ({
  bridge: { request: mocks.request, onEvent: vi.fn(() => () => {}) },
}));

import { computeChunks, computeFolds } from "../utils/diff-model";
import { OUTLINE_RETRY_DELAYS, useFoldScopes } from "./useFoldScopes";

const many = Array.from({ length: 40 }, (_, i) => `line ${i}`);
const changed = many.map((l, i) => (i === 30 ? "changed" : l));
const chunks = computeChunks(`${many.join("\n")}\n`, `${changed.join("\n")}\n`);
const [fold] = computeFolds(chunks);

const outline = (name: string) => ({
  kind: "symbols",
  symbols: [
    {
      name,
      kind: 11,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 39, character: 1 },
      },
      children: [],
    },
  ],
});
const EMPTY = { kind: "symbols", symbols: [] };

describe("useFoldScopes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    mocks.request.mockReset();
  });

  const flush = async (ms = 0) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("asks for the side's outline once and names the fold's scope from it", async () => {
    mocks.request.mockResolvedValue(outline("handle"));
    const { result } = renderHook(() =>
      useFoldScopes({ side: "right", ref: "", path: "a.ts", version: "v1" }),
    );
    expect(result.current(fold)).toBeNull();
    await flush();
    expect(result.current(fold)).toBe("handle()");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith("languageQuery", {
      kind: "symbols",
      ref: "",
      path: "a.ts",
    });
  });

  it("asks again, later each time, while the answer is empty", async () => {
    mocks.request
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValue(outline("dispatch"));
    const { result } = renderHook(() =>
      useFoldScopes({ side: "right", ref: "", path: "a.ts", version: "v1" }),
    );
    await flush();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(result.current(fold)).toBeNull();
    await flush(OUTLINE_RETRY_DELAYS[0] - 1);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(result.current(fold)).toBeNull();
    await flush(OUTLINE_RETRY_DELAYS[1]);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(result.current(fold)).toBe("dispatch()");
    // Answered: no more asking.
    await flush(60000);
    expect(mocks.request).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last retry and stops asking", async () => {
    mocks.request.mockResolvedValue(EMPTY);
    const { result } = renderHook(() =>
      useFoldScopes({ side: "right", ref: "", path: "a.ts", version: "v1" }),
    );
    await flush(60000);
    expect(mocks.request).toHaveBeenCalledTimes(
      OUTLINE_RETRY_DELAYS.length + 1,
    );
    expect(result.current(fold)).toBeNull();
  });

  it("keeps the last outline up until a new version answers, and drops it for another document", async () => {
    mocks.request.mockResolvedValueOnce(outline("first"));
    const { result, rerender } = renderHook(
      (props: { version: string; path: string; side: "left" | "right" }) =>
        useFoldScopes({ side: props.side, ref: "", ...props }),
      { initialProps: { version: "v1", path: "a.ts", side: "right" } },
    );
    await flush();
    expect(result.current(fold)).toBe("first()");
    // A save: the badges stand while the outline is asked for again.
    let answer: (value: unknown) => void = () => {};
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    rerender({ version: "v2", path: "a.ts", side: "right" });
    expect(result.current(fold)).toBe("first()");
    await act(async () => {
      answer(outline("second"));
    });
    expect(result.current(fold)).toBe("second()");
    // Another document, or the other side: the old outline names nothing.
    mocks.request.mockImplementationOnce(() => new Promise(() => {}));
    rerender({ version: "v2", path: "b.ts", side: "right" });
    expect(result.current(fold)).toBeNull();
  });

  it("asks nothing without a side or a version", async () => {
    const { result } = renderHook(() =>
      useFoldScopes({ side: null, ref: "", path: "a.ts", version: "v1" }),
    );
    await flush();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result.current(fold)).toBeNull();
  });
});
