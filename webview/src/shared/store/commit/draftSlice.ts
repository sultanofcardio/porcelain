import type { CommitDraftSlice, CommitSliceContext } from "./types";

export function createDraftSlice({
  set,
  get,
  coordinator,
  request,
}: CommitSliceContext): CommitDraftSlice {
  return {
    commitMessage: "",
    amend: false,
    signOff: false,
    noVerify: false,
    author: "",

    setSignOff(signOff) {
      set({ signOff });
    },

    setNoVerify(noVerify) {
      set({ noVerify });
    },

    setAuthor(author) {
      set({ author });
    },

    async loadMessageTemplate() {
      const result = (await request("getCommitTemplate").catch(() => null)) as {
        template: string | null;
        mergeMessage: string | null;
      } | null;
      // Mid-merge git prepares its own message, which wins over the template.
      const seed = result?.mergeMessage ?? result?.template;
      if (seed && !get().commitMessage) set({ commitMessage: seed });
    },

    setCommitMessage(message) {
      set({ commitMessage: message });
    },

    setAmend(amend) {
      set({ amend });
      if (!amend) return;

      void coordinator
        .runLatest(
          "commit.amend-message",
          async () =>
            (await request("getAmendMessage")) as { message?: string } | null,
          (result) => {
            if (result?.message) set({ commitMessage: result.message });
          },
        )
        .catch(() => {});
    },
  };
}
