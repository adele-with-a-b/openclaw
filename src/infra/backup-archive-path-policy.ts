import path from "node:path";
import { isWindowsDrivePath } from "./archive-path.js";

// Creation and verification must agree on which archive paths can be restored.
function assertPortableRelativePathSyntax(
  value: string,
  label: string,
  reportedValue = value,
): void {
  if (value.startsWith("/") || isWindowsDrivePath(value)) {
    throw new Error(`${label} must be relative: ${reportedValue}`);
  }
  if (value.includes("\\")) {
    throw new Error(`${label} must use forward slashes: ${reportedValue}`);
  }
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

export function normalizeArchivePath(entryPath: string, label: string): string {
  const filename = stripTrailingSlashes(entryPath);
  if (!filename) {
    throw new Error(`${label} is empty.`);
  }
  assertPortableRelativePathSyntax(filename, label, entryPath);
  if (filename.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`${label} contains path traversal segments: ${entryPath}`);
  }

  const normalized = stripTrailingSlashes(path.posix.normalize(filename));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} resolves outside the archive root: ${entryPath}`);
  }
  return normalized;
}

export function normalizeArchiveRoot(rootName: string): string {
  const normalized = normalizeArchivePath(rootName, "Backup manifest archiveRoot");
  if (normalized.includes("/")) {
    throw new Error(`Backup manifest archiveRoot must be a single path segment: ${rootName}`);
  }
  return normalized;
}

export function isArchivePathWithin(child: string, parent: string): boolean {
  const relative = path.posix.relative(parent, child);
  return relative === "" || (!relative.startsWith("../") && relative !== "..");
}

export type BackupSymbolicLink = { entryPath: string; linkpath: string };

export function recordArchiveSymbolicLink(params: {
  archiveRoot: string;
  entryPath: string;
  linkpath?: string;
  platform: string;
  assets: readonly { archivePath: string; sourcePath: string }[];
}): BackupSymbolicLink & { external: boolean } {
  if (!params.linkpath || params.linkpath.includes("\0")) {
    throw new Error(`Archive symbolic link is missing its target: ${params.entryPath}`);
  }
  const entryPath = normalizeArchivePath(params.entryPath, "Archive symbolic link path");
  const asset = params.assets.find(({ archivePath }) =>
    isArchivePathWithin(entryPath, archivePath),
  );
  if (!asset || !isArchivePathWithin(entryPath, normalizeArchiveRoot(params.archiveRoot))) {
    throw new Error(
      `Archive symbolic link is outside the declared backup assets: ${params.entryPath} -> ${params.linkpath}`,
    );
  }
  // Classify the recorded first hop without opening its target or collapsing a chain.
  const sourcePaths = params.platform === "win32" ? path.win32 : path.posix;
  const absolute = sourcePaths.isAbsolute(params.linkpath);
  const targetPaths = absolute ? sourcePaths : path.posix;
  const target = absolute
    ? sourcePaths.normalize(params.linkpath)
    : path.posix.join(
        path.posix.dirname(entryPath),
        params.platform === "win32" ? params.linkpath.replaceAll("\\", "/") : params.linkpath,
      );
  const external = !params.assets.some(({ sourcePath, archivePath }) => {
    const relative = targetPaths.relative(absolute ? sourcePath : archivePath, target);
    return (
      relative === "" ||
      (!targetPaths.isAbsolute(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${targetPaths.sep}`))
    );
  });
  return { entryPath: params.entryPath, linkpath: params.linkpath, external };
}
