import type { PDFDocument } from "mupdf";
import { normalizeStructuredText } from "./structured-text";

type MupdfModule = typeof import("mupdf");

type MupdfWasmModuleConfig = {
  locateFile?: (path: string) => string;
};

const wasmModuleConfig = ((
  globalThis as typeof globalThis & {
    $libmupdf_wasm_Module?: MupdfWasmModuleConfig;
  }
).$libmupdf_wasm_Module ??= {});

// In Vite dev, requests for /node_modules/.../mupdf-wasm.wasm can fall back to
// index.html. Pointing MuPDF at Vite's @fs URL keeps worker startup on the
// actual binary during local development without changing packaged builds.
if (import.meta.env.DEV) {
  const devWasmUrl = `/@fs/${__MUPDF_WASM_FS_PATH__}`;
  wasmModuleConfig.locateFile = (path: string) => {
    if (path.endsWith("mupdf-wasm.wasm")) {
      return devWasmUrl;
    }
    return path;
  };
}

const mupdf: MupdfModule = await import("mupdf");

const documentMap = new Map<number, PDFDocument>();
let nextDocId = 1;

const methods: Record<string, (...args: any[]) => any> = {};

methods.openDocument = (buffer: ArrayBuffer, magic: string): number => {
  const docId = nextDocId++;
  const doc = mupdf.Document.openDocument(
    buffer,
    magic,
  ) as unknown as PDFDocument;
  documentMap.set(docId, doc);
  return docId;
};

methods.closeDocument = (docId: number): void => {
  const doc = documentMap.get(docId);
  if (doc) {
    documentMap.delete(docId);
    // Explicitly free the WASM-side document. The FinalizationRegistry fallback
    // rarely fires (the JS GC sees only a tiny wrapper object while the WASM
    // heap balloons), so without this every closed document leaks its full
    // parsed PDF in the WASM heap.
    doc.destroy();
    // Trim the shared store (decoded images, glyphs) — an image-heavy document
    // can leave hundreds of MB of decoded resources cached with no pressure
    // signal that would ever evict them.
    mupdf.shrinkStore(50);
  }
};

methods.countPages = (docId: number): number => {
  const doc = documentMap.get(docId)!;
  return doc.countPages();
};

methods.getPageSize = (
  docId: number,
  pageIndex: number,
): { width: number; height: number } => {
  const doc = documentMap.get(docId)!;
  const page = doc.loadPage(pageIndex);
  const bounds = page.getBounds();
  page.destroy();
  return {
    width: bounds[2] - bounds[0],
    height: bounds[3] - bounds[1],
  };
};

methods.getAllPageSizes = (
  docId: number,
): { width: number; height: number }[] => {
  const doc = documentMap.get(docId)!;
  const count = doc.countPages();
  const sizes: { width: number; height: number }[] = [];
  for (let i = 0; i < count; i++) {
    const page = doc.loadPage(i);
    const bounds = page.getBounds();
    page.destroy();
    sizes.push({
      width: bounds[2] - bounds[0],
      height: bounds[3] - bounds[1],
    });
  }
  return sizes;
};

// MuPDF's store (decoded images, glyphs) is only trimmed when a document
// closes, so a long reading session over a figure-heavy PDF grows the WASM
// heap unboundedly — the 2026-07-29 OOM dump showed it at 2.4 GB. Trim it
// every so often while rendering; shrinkStore on a small store is cheap.
const RENDERS_PER_TRIM = 32;
let rendersSinceTrim = 0;

methods.trimStore = (percent: number): void => {
  mupdf.shrinkStore(percent);
};

methods.drawPage = (
  docId: number,
  pageIndex: number,
  dpi: number,
): ImageData => {
  const doc = documentMap.get(docId)!;
  const page = doc.loadPage(pageIndex);
  const scale = dpi / 72;
  const matrix = mupdf.Matrix.scale(scale, scale);

  // Render straight into an RGBA pixmap rather than page.toPixmap(alpha=false).
  // An alpha=false pixmap is 3 bytes/pixel, which then has to be interleaved
  // into RGBA in JS — ~4M iterations for an A4 page at 150 DPI, on every
  // render. Allocating the pixmap with alpha and clearing it to opaque white
  // first gives MuPDF's draw device a 4-byte-per-pixel target, so the result
  // is already in ImageData's layout and the JS side only does a bulk copy.
  const deviceBounds = mupdf.Rect.transform(page.getBounds(), matrix);
  const pixmap = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceRGB,
    deviceBounds,
    true,
  );
  // 255 across every component — opaque white, matching the white background
  // the previous alpha=false render produced.
  pixmap.clear(255);

  // The draw device maps into pixmap space, which deviceBounds already
  // accounts for, so the scale belongs on the page run rather than here.
  const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
  // run() (not runPageContents) also draws annotations and widgets, matching
  // the showExtras=true the previous toPixmap call passed.
  page.run(device, matrix);
  device.close();
  device.destroy();

  const w = pixmap.getWidth();
  const h = pixmap.getHeight();
  // getPixels() returns a live view into the WASM heap — copy out *before*
  // destroying the pixmap (destroying first is a use-after-free).
  const pixels = pixmap.getPixels();
  const stride = pixmap.getStride();
  const rowBytes = w * 4;
  const rgba = new Uint8ClampedArray(h * rowBytes);
  if (stride === rowBytes) {
    rgba.set(pixels.subarray(0, h * rowBytes));
  } else {
    // Padded rows — copy row by row. MuPDF doesn't pad its own allocations,
    // but the layout isn't contractual, and a stride mismatch would otherwise
    // shear the image.
    for (let y = 0; y < h; y++) {
      rgba.set(
        pixels.subarray(y * stride, y * stride + rowBytes),
        y * rowBytes,
      );
    }
  }
  pixmap.destroy();
  page.destroy();

  if (++rendersSinceTrim >= RENDERS_PER_TRIM) {
    rendersSinceTrim = 0;
    mupdf.shrinkStore(60);
  }

  return new ImageData(rgba, w, h);
};

methods.getPageText = (docId: number, pageIndex: number): unknown => {
  const doc = documentMap.get(docId)!;
  const page = doc.loadPage(pageIndex);
  const stext = page.toStructuredText("preserve-whitespace");
  const json = stext.asJSON();
  stext.destroy();
  page.destroy();
  return normalizeStructuredText(JSON.parse(json));
};

/** Guards against a malformed or hostile bookmark tree — neither bound is
 * reachable by a real document. */
const MAX_OUTLINE_ITEMS = 5000;
const MAX_OUTLINE_DEPTH = 12;

methods.getOutline = (docId: number): unknown[] => {
  const doc = documentMap.get(docId);
  if (!doc) return [];

  const root = doc.loadOutline();
  if (!root) return [];

  const flat: { title: string; page: number | null; level: number }[] = [];

  const walk = (items: any[], level: number): void => {
    if (level > MAX_OUTLINE_DEPTH) return;
    for (const item of items) {
      if (flat.length >= MAX_OUTLINE_ITEMS) return;

      // MuPDF resolves the destination for most bookmarks itself; fall back to
      // resolving the URI for the ones it leaves unresolved.
      let page = typeof item.page === "number" ? item.page : -1;
      if (page < 0 && item.uri) {
        try {
          const resolved = doc.resolveLink(item.uri);
          if (typeof resolved === "number") page = resolved;
        } catch {
          // Unresolvable destination — the entry is still worth listing.
        }
      }

      flat.push({
        title: (item.title ?? "").trim(),
        page: page >= 0 ? page + 1 : null,
        level,
      });

      if (Array.isArray(item.down) && item.down.length > 0) {
        walk(item.down, level + 1);
      }
    }
  };

  walk(root, 0);
  return flat;
};

/** Collapse a MuPDF quad ([ulx,uly, urx,ury, llx,lly, lrx,lry]) to its
 * bounding box. Quads are only ever axis-aligned for horizontal text, so the
 * bounding box is the quad itself in the common case and a safe envelope for
 * rotated text. */
function quadToRect(quad: number[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

methods.searchPage = (
  docId: number,
  pageIndex: number,
  needle: string,
  maxHits: number,
): unknown[][] => {
  const doc = documentMap.get(docId);
  if (!doc) return [];
  const page = doc.loadPage(pageIndex);
  try {
    // Each hit is an array of quads: one per line the match spans.
    const hits = page.search(needle, maxHits);
    return hits.map((quads) => quads.map(quadToRect));
  } finally {
    page.destroy();
  }
};

methods.getPageLinks = (docId: number, pageIndex: number): unknown[] => {
  const doc = documentMap.get(docId)!;
  const page = doc.loadPage(pageIndex);
  const links = page.getLinks();
  const result = links.map((link: any) => {
    const bounds = link.getBounds();
    const uri: string = link.getURI() || "";
    const isExternal: boolean = link.isExternal?.() ?? uri.startsWith("http");
    let href: string;
    if (isExternal) {
      href = uri;
    } else {
      try {
        const resolved = doc.resolveLink(uri) as any;
        if (typeof resolved === "number") {
          href = `#page=${resolved + 1}`;
        } else if (resolved && typeof resolved.page === "number") {
          href = `#page=${resolved.page + 1}`;
        } else {
          href = uri;
        }
      } catch {
        href = uri;
      }
    }
    return {
      x: bounds[0],
      y: bounds[1],
      w: bounds[2] - bounds[0],
      h: bounds[3] - bounds[1],
      href,
      isExternal,
    };
  });
  for (const link of links) link.destroy?.();
  page.destroy();
  return result;
};

methods.renderThumbnail = (
  docId: number,
  pageIndex: number,
  targetWidth: number,
): ArrayBuffer => {
  const doc = documentMap.get(docId)!;
  const page = doc.loadPage(pageIndex);
  const bounds = page.getBounds();
  const pageWidth = bounds[2] - bounds[0];
  const retinaScale = 2;
  const scale = (targetWidth * retinaScale) / pageWidth;
  const matrix = mupdf.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  const png = pixmap.asPNG();
  pixmap.destroy();
  page.destroy();
  return png.buffer as ArrayBuffer;
};

// RPC message handler
self.onmessage = (event: MessageEvent) => {
  const [func, id, args] = event.data as [string, number, unknown[]];
  try {
    const result = methods[func](...args);
    if (result instanceof ImageData) {
      postMessage(["RESULT", id, result], { transfer: [result.data.buffer] });
    } else if (result instanceof ArrayBuffer) {
      postMessage(["RESULT", id, result], { transfer: [result] });
    } else {
      postMessage(["RESULT", id, result]);
    }
  } catch (error: any) {
    postMessage(["ERROR", id, { name: error.name, message: error.message }]);
  }
};

postMessage(["INIT", 0, Object.keys(methods)]);
