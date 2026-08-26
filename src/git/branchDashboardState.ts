export type GitRefType = "local" | "remote" | "tag" | "detached";

export interface GitRefIdentity {
  type: GitRefType;
  name: string;
  fullRef: string;
}

export interface BranchDashboardMemento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export type SingleClickAction = "filter" | "navigate";

export interface BranchDashboardPreferences {
  showTags: boolean;
  singleClickAction: SingleClickAction;
}

interface StoredBranchDashboardState extends BranchDashboardPreferences {
  favoriteOverrides: Record<string, Record<string, boolean>>;
}

const STATE_KEY = "porcelain.branchDashboard.v1";
const DEFAULT_PREFERENCES: BranchDashboardPreferences = {
  showTags: true,
  singleClickAction: "filter",
};

const DEFAULT_FAVORITES: Readonly<Record<GitRefType, ReadonlySet<string>>> = {
  local: new Set(["main", "master"]),
  remote: new Set(["origin/main", "origin/master"]),
  tag: new Set(),
  detached: new Set(),
};

export class BranchDashboardStateStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly state: BranchDashboardMemento) {}

  isFavorite(repoId: string, type: GitRefType, name: string): boolean {
    const overrides = this.read().favoriteOverrides[repoId];
    const key = favoriteKey(type, name);
    if (overrides && Object.hasOwn(overrides, key)) {
      return overrides[key];
    }
    return DEFAULT_FAVORITES[type].has(name);
  }

  async setFavorite(
    repoId: string,
    type: GitRefType,
    name: string,
    favorite: boolean,
  ): Promise<boolean> {
    await this.enqueueWrite((current) => ({
      ...current,
      favoriteOverrides: {
        ...current.favoriteOverrides,
        [repoId]: {
          ...current.favoriteOverrides[repoId],
          [favoriteKey(type, name)]: favorite,
        },
      },
    }));
    return favorite;
  }

  getPreferences(): BranchDashboardPreferences {
    const { showTags, singleClickAction } = this.read();
    return { showTags, singleClickAction };
  }

  async updatePreferences(
    patch: Partial<BranchDashboardPreferences>,
  ): Promise<BranchDashboardPreferences> {
    await this.enqueueWrite((current) => ({
      ...current,
      ...patch,
    }));
    return this.getPreferences();
  }

  private read(): StoredBranchDashboardState {
    const stored = this.state.get<Partial<StoredBranchDashboardState>>(
      STATE_KEY,
      {},
    );
    return {
      favoriteOverrides: stored.favoriteOverrides ?? {},
      showTags: stored.showTags ?? DEFAULT_PREFERENCES.showTags,
      singleClickAction:
        stored.singleClickAction ?? DEFAULT_PREFERENCES.singleClickAction,
    };
  }

  private enqueueWrite(
    update: (current: StoredBranchDashboardState) => StoredBranchDashboardState,
  ): Promise<void> {
    const run = this.writeChain.then(async () => {
      await this.state.update(STATE_KEY, update(this.read()));
    });
    this.writeChain = run.catch(() => {});
    return run;
  }
}

function favoriteKey(type: GitRefType, name: string): string {
  return `${type}\0${name}`;
}
