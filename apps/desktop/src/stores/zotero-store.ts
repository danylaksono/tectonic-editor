import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  validateApiKey,
  validateDesktop,
  probeDesktopItems,
  fetchCollections,
  importCollection,
  syncCollection,
  searchZoteroItems,
  fetchCollectionItems,
  startOAuth,
  completeOAuth,
  cancelOAuth,
  type ZoteroConnection,
  type ZoteroConnectionMode,
  type ZoteroCollection,
  type ZoteroSearchResult,
  type ZoteroItemPage,
} from "@/lib/zotero-api";
import { useDocumentStore } from "@/stores/document-store";
import { applyHouseKeys } from "@/lib/bibliography-import";
import { createFileOnDisk } from "@/lib/tauri/fs";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("zotero");

/** Per-collection sync metadata (persisted) */
export interface CollectionSyncInfo {
  collectionKey: string | null; // null = "My Library"
  name: string;
  bibFileName: string;
  libraryVersion: number;
  keyMap: Record<string, string>;
}

/** Synced collections scoped per project path */
type ProjectSyncedCollections = Record<
  string,
  Record<string, CollectionSyncInfo>
>;

export type ZoteroDesktopStatus =
  | "unknown"
  | "checking"
  | "available"
  | "unavailable"
  | "disabled";

interface ZoteroState {
  // Persisted
  connectionMode: ZoteroConnectionMode | null;
  apiKey: string | null;
  userID: string | null;
  username: string | null;
  /** Synced collections keyed by projectPath → collectionKey */
  syncedCollections: ProjectSyncedCollections;

  // Transient
  isAuthenticated: boolean;
  isValidating: boolean;
  isSyncing: string | null; // collectionKey currently syncing, or null
  syncProgress: { loaded: number; total: number } | null;
  error: string | null;
  collections: ZoteroCollection[];
  isLoadingCollections: boolean;
  desktopStatus: ZoteroDesktopStatus;
  /** null = not probed. false = Zotero Desktop answers collections but not items. */
  desktopItemsAvailable: boolean | null;

  checkDesktop: () => Promise<boolean>;
  probeDesktopCapabilities: () => Promise<void>;
  connectWithDesktop: () => Promise<boolean>;
  connectWithOAuth: () => Promise<boolean>;
  connectWithApiKey: (apiKey: string) => Promise<boolean>;
  cancelConnect: () => void;
  disconnect: () => void;
  revalidate: () => Promise<void>;
  loadCollections: () => Promise<void>;
  searchLibrary: (
    query: string,
    limit?: number,
  ) => Promise<ZoteroSearchResult[]>;
  browseCollection: (
    collectionKey: string | null,
    start?: number,
    limit?: number,
  ) => Promise<ZoteroItemPage>;
  importCollectionToBib: (
    collectionKey: string | null,
    name: string,
  ) => Promise<void>;
  syncCollectionBib: (collectionKey: string | null) => Promise<void>;
  removeCollection: (collectionKey: string | null) => void;
}

const MYLIB_KEY = "__my_library__";
function storeKey(collectionKey: string | null): string {
  return collectionKey ?? MYLIB_KEY;
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function getConnection(
  state: Pick<ZoteroState, "connectionMode" | "apiKey" | "userID">,
): ZoteroConnection | null {
  if (state.connectionMode === "desktop") {
    return { mode: "desktop", userID: "0" };
  }
  if (state.connectionMode === "cloud" && state.apiKey && state.userID) {
    return {
      mode: "cloud",
      apiKey: state.apiKey,
      userID: state.userID,
    };
  }
  return null;
}

/** Parse a .bib file into a map of citekey → full entry string */
function parseBibEntries(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  const parts = content.split(/\n(?=@)/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/@\w+\{([^,\s]+)/);
    if (match) {
      entries.set(match[1], trimmed);
    }
  }
  return entries;
}

export const useZoteroStore = create<ZoteroState>()(
  persist(
    (set, get) => ({
      connectionMode: null,
      apiKey: null,
      userID: null,
      username: null,
      syncedCollections: {},

      isAuthenticated: false,
      isValidating: false,
      isSyncing: null,
      syncProgress: null,
      error: null,
      collections: [],
      isLoadingCollections: false,
      desktopStatus: "unknown",
      desktopItemsAvailable: null,

      checkDesktop: async () => {
        set({ desktopStatus: "checking" });
        try {
          await validateDesktop();
          set({ desktopStatus: "available" });
          void get().probeDesktopCapabilities();
          return true;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Zotero Desktop unavailable";
          set({
            desktopStatus: message.includes("Local access is disabled")
              ? "disabled"
              : "unavailable",
          });
          return false;
        }
      },

      probeDesktopCapabilities: async () => {
        const { available, error } = await probeDesktopItems();
        if (!available) {
          log.warn("Zotero Desktop cannot serve items", {
            error: String(error),
          });
        }
        set({ desktopItemsAvailable: available });
      },

      connectWithDesktop: async () => {
        set({
          isValidating: true,
          desktopStatus: "checking",
          error: null,
        });
        try {
          const creds = await validateDesktop();
          set({
            connectionMode: "desktop",
            apiKey: null,
            userID: creds.userID,
            username: creds.username,
            isAuthenticated: true,
            isValidating: false,
            desktopStatus: "available",
          });
          get().loadCollections();
          void get().probeDesktopCapabilities();
          return true;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Connection failed";
          set({
            error: message,
            isValidating: false,
            desktopStatus: message.includes("Local access is disabled")
              ? "disabled"
              : "unavailable",
          });
          return false;
        }
      },

      connectWithOAuth: async () => {
        log.info("Starting OAuth connection");
        set({ isValidating: true, error: null });
        try {
          await startOAuth();
          const creds = await completeOAuth();
          log.info(`OAuth connected as ${creds.username}`);
          set({
            connectionMode: "cloud",
            apiKey: creds.apiKey,
            userID: creds.userID,
            username: creds.username,
            isAuthenticated: true,
            isValidating: false,
          });
          // Auto-load collections after connecting
          get().loadCollections();
          return true;
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Connection failed",
            isValidating: false,
          });
          return false;
        }
      },

      connectWithApiKey: async (apiKey: string) => {
        set({ isValidating: true, error: null });
        try {
          const creds = await validateApiKey(apiKey);
          set({
            connectionMode: "cloud",
            apiKey: creds.apiKey,
            userID: creds.userID,
            username: creds.username,
            isAuthenticated: true,
            isValidating: false,
          });
          get().loadCollections();
          return true;
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Connection failed",
            isValidating: false,
          });
          return false;
        }
      },

      cancelConnect: () => {
        cancelOAuth().catch(() => {});
        set({ isValidating: false, error: null });
      },

      disconnect: () => {
        set({
          connectionMode: null,
          apiKey: null,
          userID: null,
          username: null,
          isAuthenticated: false,
          error: null,
          collections: [],
          desktopItemsAvailable: null,
        });
      },

      revalidate: async () => {
        const state = get();
        const connection = getConnection(state);
        if (!connection) return;
        try {
          const creds =
            connection.mode === "desktop"
              ? await validateDesktop()
              : await validateApiKey(connection.apiKey);
          log.debug(`Revalidated as ${creds.username}`);
          set({
            connectionMode: creds.mode,
            apiKey: creds.apiKey,
            userID: creds.userID,
            username: creds.username,
            isAuthenticated: true,
            desktopStatus:
              creds.mode === "desktop" ? "available" : get().desktopStatus,
            error: null,
          });
          get().loadCollections();
          if (creds.mode === "desktop") void get().probeDesktopCapabilities();
        } catch (err) {
          log.warn("Revalidation failed", { error: String(err) });
          const message =
            err instanceof Error ? err.message : "Connection failed";
          set({
            isAuthenticated: false,
            error: message,
            desktopStatus:
              connection.mode === "desktop"
                ? message.includes("Local access is disabled")
                  ? "disabled"
                  : "unavailable"
                : get().desktopStatus,
          });
        }
      },

      loadCollections: async () => {
        const connection = getConnection(get());
        if (!connection) return;
        set({ isLoadingCollections: true });
        try {
          const collections = await fetchCollections(connection);
          log.debug(`Loaded ${collections.length} collections`);
          set({ collections, isLoadingCollections: false });
        } catch (err) {
          log.error("Failed to load collections", { error: String(err) });
          set({ isLoadingCollections: false });
        }
      },

      searchLibrary: async (query, limit) => {
        const connection = getConnection(get());
        if (!connection) throw new Error("No Zotero library is connected");
        return searchZoteroItems(connection, query, limit);
      },

      browseCollection: async (collectionKey, start, limit) => {
        const connection = getConnection(get());
        if (!connection) throw new Error("No Zotero library is connected");
        return fetchCollectionItems(connection, collectionKey, start, limit);
      },

      importCollectionToBib: async (collectionKey, name) => {
        const connection = getConnection(get());
        if (!connection) return;

        const docStore = useDocumentStore.getState();
        if (!docStore.projectRoot) return;
        const projectRoot = docStore.projectRoot;

        const sk = storeKey(collectionKey);
        set({ isSyncing: sk, syncProgress: null, error: null });

        try {
          const result = await importCollection(
            connection,
            collectionKey,
            (loaded, total) => {
              set({ syncProgress: { loaded, total } });
            },
          );

          // Key and format every entry the way the rest of the project reads.
          // A collection already synced keeps the keys it was given, so a
          // re-import never invalidates citations in the document.
          const previousKeys =
            get().syncedCollections[projectRoot]?.[sk]?.keyMap ?? {};
          const keyed = applyHouseKeys(result.entries, previousKeys);
          const content = `${keyed.map((entry) => entry.source).join("\n\n")}\n`;
          const keyMap = Object.fromEntries(
            keyed.map((entry) => [entry.itemKey, entry.citekey]),
          );

          // Determine .bib file name
          const bibFileName = `${sanitizeFileName(name)}.bib`;

          // Check if this .bib file already exists in the project
          const existingFile = docStore.files.find(
            (f) => f.name === bibFileName,
          );
          if (existingFile) {
            docStore.updateFileContent(existingFile.id, content);
          } else {
            const fullPath = await createFileOnDisk(
              projectRoot,
              bibFileName,
              content,
            );
            docStore.addFile({
              name: bibFileName,
              relativePath: bibFileName,
              absolutePath: fullPath,
              type: "bib",
              content,
            });
          }

          // Store sync info scoped to current project
          const syncInfo: CollectionSyncInfo = {
            collectionKey,
            name,
            bibFileName,
            libraryVersion: result.libraryVersion,
            keyMap,
          };
          set((s) => {
            const projectColls = s.syncedCollections[projectRoot] ?? {};
            return {
              syncedCollections: {
                ...s.syncedCollections,
                [projectRoot]: { ...projectColls, [sk]: syncInfo },
              },
              isSyncing: null,
              syncProgress: null,
            };
          });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Import failed",
            isSyncing: null,
            syncProgress: null,
          });
        }
      },

      syncCollectionBib: async (collectionKey) => {
        const state = get();
        const connection = getConnection(state);
        if (!connection) return;
        const { syncedCollections } = state;

        const docStore = useDocumentStore.getState();
        if (!docStore.projectRoot) return;
        const projectRoot = docStore.projectRoot;

        const sk = storeKey(collectionKey);
        const projectColls = syncedCollections[projectRoot] ?? {};
        const syncInfo = projectColls[sk];
        if (!syncInfo) return;

        const bibFile = docStore.files.find(
          (f) => f.name === syncInfo.bibFileName,
        );
        if (!bibFile) return;

        set({ isSyncing: sk, syncProgress: null, error: null });

        try {
          const result = await syncCollection(
            connection,
            collectionKey,
            syncInfo.libraryVersion,
            (loaded, total) => {
              set({ syncProgress: { loaded, total } });
            },
          );

          if (collectionKey) {
            // For specific collections, syncCollection returns a full re-import,
            // so rebuild the file. Items already synced keep their keys.
            const keyed = applyHouseKeys(
              result.updatedEntries.map((entry) => ({
                itemKey: entry.key,
                bibtex: entry.bibtex,
              })),
              syncInfo.keyMap,
            );
            const newKeyMap = Object.fromEntries(
              keyed.map((entry) => [entry.itemKey, entry.citekey]),
            );
            const updatedContent = `${keyed
              .map((entry) => entry.source)
              .join("\n\n")}\n`;
            docStore.updateFileContent(bibFile.id, updatedContent);

            set((s) => {
              const pColls = s.syncedCollections[projectRoot] ?? {};
              return {
                syncedCollections: {
                  ...s.syncedCollections,
                  [projectRoot]: {
                    ...pColls,
                    [sk]: {
                      ...syncInfo,
                      libraryVersion: result.libraryVersion,
                      keyMap: newKeyMap,
                    },
                  },
                },
                isSyncing: null,
                syncProgress: null,
              };
            });
          } else {
            // For "My Library", apply incremental diff
            const currentContent = bibFile.content ?? "";
            const entries = parseBibEntries(currentContent);
            const newKeyMap = { ...syncInfo.keyMap };
            const keyed = applyHouseKeys(
              result.updatedEntries.map((entry) => ({
                itemKey: entry.key,
                bibtex: entry.bibtex,
              })),
              syncInfo.keyMap,
            );

            for (const entry of keyed) {
              const oldCitekey = newKeyMap[entry.itemKey];
              if (oldCitekey && oldCitekey !== entry.citekey) {
                entries.delete(oldCitekey);
              }
              entries.set(entry.citekey, entry.source);
              newKeyMap[entry.itemKey] = entry.citekey;
            }

            for (const deletedKey of result.deletedKeys) {
              const citekey = newKeyMap[deletedKey];
              if (citekey) {
                entries.delete(citekey);
                delete newKeyMap[deletedKey];
              }
            }

            const updatedContent = `${Array.from(entries.values()).join("\n\n")}\n`;
            docStore.updateFileContent(bibFile.id, updatedContent);

            set((s) => {
              const pColls = s.syncedCollections[projectRoot] ?? {};
              return {
                syncedCollections: {
                  ...s.syncedCollections,
                  [projectRoot]: {
                    ...pColls,
                    [sk]: {
                      ...syncInfo,
                      libraryVersion: result.libraryVersion,
                      keyMap: newKeyMap,
                    },
                  },
                },
                isSyncing: null,
                syncProgress: null,
              };
            });
          }
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Sync failed",
            isSyncing: null,
            syncProgress: null,
          });
        }
      },

      removeCollection: (collectionKey) => {
        const projectRoot = useDocumentStore.getState().projectRoot;
        if (!projectRoot) return;

        const sk = storeKey(collectionKey);
        set((s) => {
          const projectColls = s.syncedCollections[projectRoot] ?? {};
          const { [sk]: _, ...rest } = projectColls;
          return {
            syncedCollections: {
              ...s.syncedCollections,
              [projectRoot]: rest,
            },
          };
        });
      },
    }),
    {
      name: "tectonic-editor-zotero",
      partialize: (state) => ({
        connectionMode: state.connectionMode,
        apiKey: state.apiKey,
        userID: state.userID,
        username: state.username,
        syncedCollections: state.syncedCollections,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.apiKey && !state.connectionMode) {
          state.connectionMode = "cloud";
        }
        if (state?.connectionMode) {
          state.isAuthenticated = true;
        }
      },
    },
  ),
);
