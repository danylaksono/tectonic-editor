import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";

const ZOTERO_BASE = "https://api.zotero.org";

export type ZoteroConnectionMode = "desktop" | "cloud";

export interface ZoteroCredentials {
  mode: ZoteroConnectionMode;
  apiKey: string | null;
  userID: string;
  username: string;
}

export type ZoteroConnection =
  | {
      mode: "desktop";
      userID: "0";
    }
  | {
      mode: "cloud";
      apiKey: string;
      userID: string;
    };

export interface ZoteroCollection {
  key: string;
  name: string;
  parentKey: string | false;
  itemCount: number;
}

/** One imported item: the Zotero item key and the BibTeX Zotero exported. */
export interface ZoteroBibtexEntry {
  itemKey: string;
  bibtex: string;
}

/** Result of importing a collection */
export interface CollectionImportResult {
  entries: ZoteroBibtexEntry[];
  libraryVersion: number;
  keyMap: Record<string, string>;
  totalItems: number;
}

/** Result of an incremental sync */
export interface CollectionSyncResult {
  updatedEntries: { key: string; citekey: string; bibtex: string }[];
  deletedKeys: string[];
  libraryVersion: number;
}

// ─── OAuth Flow (via Tauri Rust backend) ───

export async function startOAuth(): Promise<void> {
  const result = await invoke<{ authorize_url: string }>("zotero_start_oauth");
  await open(result.authorize_url);
}

export async function completeOAuth(): Promise<ZoteroCredentials> {
  const result = await invoke<{
    api_key: string;
    user_id: string;
    username: string;
  }>("zotero_complete_oauth");
  return {
    mode: "cloud",
    apiKey: result.api_key,
    userID: result.user_id,
    username: result.username,
  };
}

export async function cancelOAuth(): Promise<void> {
  await invoke("zotero_cancel_oauth");
}

// ─── Zotero Web API v3 ───

interface ZoteroLocalResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

async function zoteroFetch(
  connection: ZoteroConnection,
  path: string,
  headers?: Record<string, string>,
): Promise<Response> {
  const response =
    connection.mode === "desktop"
      ? await invoke<ZoteroLocalResponse>("zotero_local_request", {
          path,
        }).then(
          (result) =>
            new Response(result.body, {
              status: result.status,
              headers: result.headers,
            }),
        )
      : await fetch(`${ZOTERO_BASE}${path}`, {
          headers: {
            "Zotero-API-Key": connection.apiKey,
            "Zotero-API-Version": "3",
            ...headers,
          },
        });
  if (!response.ok) {
    if (response.status === 304) return response;
    throw new Error(await describeZoteroError(connection, response));
  }
  return response;
}

/**
 * Zotero Desktop's local API serves collections but can fail to serialize
 * items on some builds, answering every /items request with an empty-bodied
 * HTTP 500. Name that case explicitly so it does not surface as a bare code.
 */
export const DESKTOP_ITEMS_UNAVAILABLE =
  "Zotero Desktop could not read item data (HTTP 500). Its local API is serving collections but failing on items — restart or update Zotero, or connect Zotero Cloud instead.";

async function describeZoteroError(
  connection: ZoteroConnection,
  response: Response,
): Promise<string> {
  let detail = "";
  try {
    detail = (await response.text()).trim().slice(0, 200);
  } catch {
    detail = "";
  }
  if (response.status === 403) {
    return connection.mode === "desktop"
      ? "Local access is disabled in Zotero. Enable “Allow other applications on this computer to communicate with Zotero” in Settings → Advanced."
      : "Invalid or expired Zotero API key";
  }
  if (response.status === 404 && connection.mode === "desktop") {
    return "Zotero Desktop does not implement this request. Connect Zotero Cloud for full library access.";
  }
  if (response.status >= 500) {
    return connection.mode === "desktop"
      ? `${DESKTOP_ITEMS_UNAVAILABLE}${detail ? ` (${detail})` : ""}`
      : `Zotero's server returned an error (HTTP ${response.status})${
          detail ? `: ${detail}` : ""
        }. Try again in a moment.`;
  }
  return `Zotero API error: ${response.status}${detail ? ` — ${detail}` : ""}`;
}

function extractCitekey(bibtex: string): string {
  const match = bibtex.match(/@\w+\{([^,\s]+)/);
  return match ? match[1] : "";
}

export async function validateApiKey(
  apiKey: string,
): Promise<ZoteroCredentials> {
  const connection: ZoteroConnection = {
    mode: "cloud",
    apiKey,
    userID: "",
  };
  const response = await zoteroFetch(connection, "/keys/current");
  const data = await response.json();
  return {
    mode: "cloud",
    apiKey,
    userID: String(data.userID),
    username: data.username ?? "",
  };
}

export async function validateDesktop(): Promise<ZoteroCredentials> {
  await zoteroFetch(
    { mode: "desktop", userID: "0" },
    "/users/0/collections?limit=1",
  );
  return {
    mode: "desktop",
    apiKey: null,
    userID: "0",
    username: "Zotero Desktop",
  };
}

/**
 * Collections answering does not mean items will. Probe one item read so the
 * panel can warn before an import fails halfway through.
 */
export async function probeDesktopItems(): Promise<{
  available: boolean;
  error: string | null;
}> {
  try {
    await zoteroFetch(
      { mode: "desktop", userID: "0" },
      "/users/0/items/top?format=json&limit=1",
    );
    return { available: true, error: null };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ─── Collections ───

export async function fetchCollections(
  connection: ZoteroConnection,
): Promise<ZoteroCollection[]> {
  const response = await zoteroFetch(
    connection,
    `/users/${connection.userID}/collections?format=json`,
  );
  const data = (await response.json()) as {
    key: string;
    data: { key: string; name: string; parentCollection: string | false };
    meta: { numItems: number };
  }[];
  return data.map((c) => ({
    key: c.key,
    name: c.data.name,
    parentKey: c.data.parentCollection,
    itemCount: c.meta.numItems,
  }));
}

// ─── Item Search ───

export interface ZoteroSearchResult {
  /** Zotero item key, stable across searches */
  key: string;
  title: string;
  creators: string;
  year: string;
  itemType: string;
  publication: string;
  bibtex: string;
}

interface ZoteroCreator {
  firstName?: string;
  lastName?: string;
  name?: string;
}

function formatCreators(creators: ZoteroCreator[] | undefined): string {
  if (!creators?.length) return "";
  const name = (creator: ZoteroCreator) =>
    creator.lastName?.trim() || creator.name?.trim() || "";
  const first = name(creators[0]);
  if (!first) return "";
  if (creators.length === 1) return first;
  if (creators.length === 2) {
    const second = name(creators[1]);
    return second ? `${first} and ${second}` : first;
  }
  return `${first} et al.`;
}

function extractYear(date: string | undefined): string {
  return date?.match(/\d{4}/)?.[0] ?? "";
}

interface RawZoteroItem {
  key: string;
  bibtex?: string;
  data?: {
    title?: string;
    itemType?: string;
    date?: string;
    creators?: ZoteroCreator[];
    publicationTitle?: string;
    bookTitle?: string;
    publisher?: string;
    proceedingsTitle?: string;
  };
}

/** Item fields the browser and the picker both display. */
function mapZoteroItems(items: RawZoteroItem[]): ZoteroSearchResult[] {
  return items.flatMap((item) => {
    const bibtex = item.bibtex?.trim() ?? "";
    if (!bibtex) return [];
    const data = item.data ?? {};
    return [
      {
        key: item.key,
        title: data.title?.trim() || item.key,
        creators: formatCreators(data.creators),
        year: extractYear(data.date),
        itemType: data.itemType ?? "",
        publication:
          data.publicationTitle?.trim() ||
          data.proceedingsTitle?.trim() ||
          data.bookTitle?.trim() ||
          data.publisher?.trim() ||
          "",
        bibtex,
      },
    ];
  });
}

/** Notes and standalone attachments have no BibTeX form, so never list them. */
const CITABLE_ITEM_TYPES = "-attachment||note";

/**
 * Search top-level items across the library. Zotero's `titleCreatorYear` mode
 * matches the fields a citation picker cares about.
 */
export async function searchZoteroItems(
  connection: ZoteroConnection,
  query: string,
  limit = 25,
): Promise<ZoteroSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    qmode: "titleCreatorYear",
    format: "json",
    include: "data,bibtex",
    itemType: CITABLE_ITEM_TYPES,
    limit: String(limit),
  });
  const response = await zoteroFetch(
    connection,
    `/users/${connection.userID}/items/top?${params}`,
  );
  return mapZoteroItems((await response.json()) as RawZoteroItem[]);
}

/** One page of a collection's items, plus how many there are in total. */
export interface ZoteroItemPage {
  items: ZoteroSearchResult[];
  total: number;
}

/**
 * List the top-level items of one collection, newest first, for browsing
 * before import. `collectionKey = null` lists the whole library.
 */
export async function fetchCollectionItems(
  connection: ZoteroConnection,
  collectionKey: string | null,
  start = 0,
  limit = 50,
): Promise<ZoteroItemPage> {
  const basePath = collectionKey
    ? `/users/${connection.userID}/collections/${collectionKey}/items/top`
    : `/users/${connection.userID}/items/top`;
  const params = new URLSearchParams({
    format: "json",
    include: "data,bibtex",
    itemType: CITABLE_ITEM_TYPES,
    sort: "dateAdded",
    direction: "desc",
    limit: String(limit),
    start: String(start),
  });
  const response = await zoteroFetch(connection, `${basePath}?${params}`);
  const items = mapZoteroItems((await response.json()) as RawZoteroItem[]);
  return {
    items,
    total: Number(response.headers.get("Total-Results") ?? items.length),
  };
}

// ─── Collection Import (full download) ───

/**
 * Import all items from a specific collection.
 * Pass collectionKey = null to import the entire "My Library" (all top-level items).
 */
export async function importCollection(
  connection: ZoteroConnection,
  collectionKey: string | null,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CollectionImportResult> {
  const basePath = collectionKey
    ? `/users/${connection.userID}/collections/${collectionKey}/items/top`
    : `/users/${connection.userID}/items/top`;

  const entries: ZoteroBibtexEntry[] = [];
  const keyMap: Record<string, string> = {};
  let start = 0;
  const limit = 100;
  let total = 0;
  let libraryVersion = 0;

  while (true) {
    const params = new URLSearchParams({
      format: "json",
      include: "bibtex",
      limit: String(limit),
      start: String(start),
    });
    const response = await zoteroFetch(connection, `${basePath}?${params}`);

    if (start === 0) {
      total = Number(response.headers.get("Total-Results") ?? 0);
      libraryVersion = Number(
        response.headers.get("Last-Modified-Version") ?? 0,
      );
    }

    const items = (await response.json()) as { key: string; bibtex?: string }[];
    if (items.length === 0) break;

    for (const item of items) {
      const bibtex = item.bibtex?.trim() ?? "";
      if (!bibtex) continue;
      const citekey = extractCitekey(bibtex);
      if (citekey) keyMap[item.key] = citekey;
      entries.push({ itemKey: item.key, bibtex });
    }

    start += limit;
    onProgress?.(Math.min(start, total), total);
    if (start >= total) break;
  }

  return { entries, libraryVersion, keyMap, totalItems: total };
}

// ─── Incremental Sync ───

/**
 * Sync changes for a specific collection since lastVersion.
 * collectionKey = null syncs the entire library.
 *
 * Note: Zotero's `since` param works at the library level (not per-collection),
 * so for collection sync we re-fetch all collection items and diff locally.
 */
export async function syncCollection(
  connection: ZoteroConnection,
  collectionKey: string | null,
  lastVersion: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CollectionSyncResult> {
  // For "My Library" (all items), we can use the `since` param
  if (!collectionKey) {
    return syncFullLibrary(connection, lastVersion, onProgress);
  }

  // For a specific collection, re-fetch all items and diff against keyMap
  // (Zotero API doesn't support `since` scoped to a collection)
  const result = await importCollection(connection, collectionKey, onProgress);

  return {
    updatedEntries: result.entries.map((entry) => ({
      key: entry.itemKey,
      citekey: extractCitekey(entry.bibtex),
      bibtex: entry.bibtex,
    })),
    deletedKeys: [],
    libraryVersion: result.libraryVersion,
  };
}

async function syncFullLibrary(
  connection: ZoteroConnection,
  lastVersion: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CollectionSyncResult> {
  const updatedEntries: CollectionSyncResult["updatedEntries"] = [];
  let start = 0;
  const limit = 100;
  let total = 0;
  let newVersion = lastVersion;

  while (true) {
    const params = new URLSearchParams({
      since: String(lastVersion),
      format: "json",
      include: "bibtex",
      limit: String(limit),
      start: String(start),
    });
    const response = await zoteroFetch(
      connection,
      `/users/${connection.userID}/items/top?${params}`,
    );

    if (start === 0) {
      total = Number(response.headers.get("Total-Results") ?? 0);
      newVersion = Number(
        response.headers.get("Last-Modified-Version") ?? lastVersion,
      );
    }

    const items = (await response.json()) as { key: string; bibtex?: string }[];
    if (items.length === 0) break;

    for (const item of items) {
      const bibtex = item.bibtex ?? "";
      if (!bibtex.trim()) continue;
      const citekey = extractCitekey(bibtex);
      updatedEntries.push({ key: item.key, citekey, bibtex });
    }

    start += limit;
    onProgress?.(Math.min(start, total), total);
    if (start >= total) break;
  }

  // Fetch deleted items. Zotero Desktop's local API has no /deleted route, so
  // treat its absence as "nothing removed" rather than failing the whole sync.
  let deletedKeys: string[] = [];
  try {
    const deletedResponse = await zoteroFetch(
      connection,
      `/users/${connection.userID}/deleted?since=${lastVersion}`,
    );
    const deleted = (await deletedResponse.json()) as { items?: string[] };
    deletedKeys = deleted.items ?? [];

    if (!newVersion || newVersion === lastVersion) {
      newVersion = Number(
        deletedResponse.headers.get("Last-Modified-Version") ?? lastVersion,
      );
    }
  } catch (error) {
    if (connection.mode !== "desktop") throw error;
  }

  return { updatedEntries, deletedKeys, libraryVersion: newVersion };
}
