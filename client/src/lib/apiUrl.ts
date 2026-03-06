const rawApiBaseUrl = (import.meta.env.VITE_API_URL ?? "").trim();
const apiBaseUrl = rawApiBaseUrl.replace(/\/+$/, "");

export function withApiBase(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!apiBaseUrl) {
    return normalizedPath;
  }

  return `${apiBaseUrl}${normalizedPath}`;
}

